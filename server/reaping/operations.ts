// Operator-driven reaping actions (M1, docs/adr/0005, 0006). Thin domain layer over the state
// machine + notifier that the API routes call. No auth yet — the operator drives every action and
// records appeals on a member's behalf.

import { eq } from 'drizzle-orm'
import type { getDb } from '../db/client'
import { schema } from '../db/client'
import { applyTransition, type Actor } from './stateMachine'
import { emailNotifier, type NotifyTitle } from './notifier'

type Db = ReturnType<typeof getDb>

const DEFAULT_GRACE_DAYS = 7
const DAY_MS = 86_400_000

// M1 has no session (docs/adr/0006): an admin action with no supplied person is recorded as a
// system actor rather than fabricating an identity. Session-derived person actors arrive in M2.
function adminActor(actorPersonId: number | null): Actor {
  return actorPersonId != null ? { personId: actorPersonId } : { system: 'system' }
}

export function getGraceDays(db: Db): number {
  const row = db.select({ value: schema.appSetting.value }).from(schema.appSetting)
    .where(eq(schema.appSetting.key, 'reaping_grace_days')).get()
  const n = row ? Number(row.value) : NaN
  return Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_GRACE_DAYS
}

function notifyTitle(db: Db, titleId: number): NotifyTitle | null {
  const t = db.select({ id: schema.title.id, episode: schema.title.episode, title: schema.title.title, dueAt: schema.title.dueAt })
    .from(schema.title).where(eq(schema.title.id, titleId)).get()
  return t ?? null
}

export interface ScheduleOptions {
  graceDays?: number
  sendReminder?: boolean
  actorPersonId?: number | null
}

// eligible → scheduled. Sets the clock and fires the `scheduled` notification.
export async function scheduleTitle(db: Db, titleId: number, opts: ScheduleOptions, now: number = Date.now()) {
  const graceDays = opts.graceDays && opts.graceDays > 0 ? Math.round(opts.graceDays) : getGraceDays(db)
  const scheduledAt = new Date(now).toISOString()
  const dueAt = new Date(now + graceDays * DAY_MS).toISOString()
  const res = applyTransition(db, titleId, {
    to: 'scheduled', reason: 'admin_scheduled', actor: adminActor(opts.actorPersonId ?? null),
    patch: { scheduledAt, dueAt, sendReminder: opts.sendReminder ? 1 : 0 }, now
  })
  const t = notifyTitle(db, titleId)
  if (t) await emailNotifier.notify(db, 'scheduled', t, now)
  return { ...res, dueAt, graceDays }
}

// {scheduled|appealed|due} → eligible (admin cancels the reaping).
export function cancelSchedule(db: Db, titleId: number, actorPersonId: number | null, now: number = Date.now()) {
  return applyTransition(db, titleId, { to: 'eligible', reason: 'admin_cancelled', actor: adminActor(actorPersonId), now })
}

// Note: there is deliberately no extend/shorten. Once the appointment is made and members are
// notified, the sands don't move — the only escape is to cancel (→ reprieve) and, if wanted,
// schedule afresh as a new appointment. This keeps the clock and the notified due date honest.

// scheduled → appealed, recorded on a member's behalf (M1). Session-derived identity arrives in M2.
export function raiseAppeal(db: Db, titleId: number, appellantPersonId: number, now: number = Date.now()) {
  return applyTransition(db, titleId, { to: 'appealed', reason: 'member_appealed', actor: { personId: appellantPersonId }, now })
}

// appealed → scheduled (the appellant withdrew; the clock continues).
export function withdrawAppeal(db: Db, titleId: number, actorPersonId: number | null, now: number = Date.now()) {
  return applyTransition(db, titleId, { to: 'scheduled', reason: 'appeal_withdrawn', actor: adminActor(actorPersonId), now })
}

// Resolve an appeal: grant → reprieve (eligible, notify reprieved); deny → scheduled (clock continues).
export async function resolveAppeal(db: Db, titleId: number, decision: 'grant' | 'deny', actorPersonId: number | null, now: number = Date.now()) {
  if (decision === 'grant') {
    const res = applyTransition(db, titleId, { to: 'eligible', reason: 'appeal_granted', actor: adminActor(actorPersonId), now })
    const t = notifyTitle(db, titleId)
    if (t) await emailNotifier.notify(db, 'reprieved', t, now)
    return res
  }
  return applyTransition(db, titleId, { to: 'scheduled', reason: 'appeal_denied', actor: adminActor(actorPersonId), now })
}

// due → removed (admin actioned removal in the *arr; optimistic). Fires the `departed` notification.
export async function markRemoved(db: Db, titleId: number, actorPersonId: number | null, now: number = Date.now()) {
  const res = applyTransition(db, titleId, { to: 'removed', reason: 'admin_marked_removed', actor: adminActor(actorPersonId), now })
  const t = notifyTitle(db, titleId)
  if (t) await emailNotifier.notify(db, 'departed', t, now)
  return res
}
