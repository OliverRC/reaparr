// Sync-time reaping pass (docs/adr/0001, 0005). Runs after persistBundle each sync and advances the
// clock: auto-reprieve titles watched during grace, flip elapsed titles to `due`, and send the
// opt-in reminder. Presence-dependent work (tombstoning, resurrection, discrepancy detection) lives
// in persist.ts, where the *arr pull is known; this pass is purely time/clock driven.

import { eq } from 'drizzle-orm'
import type { getDb } from '../db/client'
import { schema } from '../db/client'
import { applyTransition } from './stateMachine'
import { emailNotifier, type Notifier } from './notifier'

type Db = ReturnType<typeof getDb>

const DAY_MS = 86_400_000

export interface ReapingTickCounts {
  autoReprieved: number
  dueFlipped: number
  remindersSent: number
}

// A title has been watched during its grace window if its latest watch is at/after it was scheduled.
function watchedSinceScheduled(db: Db, titleId: number, scheduledAt: string): boolean {
  const items = db.select({ last: schema.watchedItem.lastWatchedAt }).from(schema.watchedItem)
    .where(eq(schema.watchedItem.titleId, titleId)).all()
  const sched = Date.parse(scheduledAt)
  return items.some(i => i.last != null && Date.parse(i.last) >= sched)
}

export async function runReapingTick(
  db: Db,
  now: number = Date.now(),
  notifier: Notifier = emailNotifier
): Promise<ReapingTickCounts> {
  const counts: ReapingTickCounts = { autoReprieved: 0, dueFlipped: 0, remindersSent: 0 }
  const active = db.select().from(schema.title).all()
    .filter(t => t.state === 'scheduled' || t.state === 'appealed' || t.state === 'due')

  // 1. Auto-reprieve — watching during grace is the strongest objection. Evaluated before the due
  //    flip so a watched title is rescued rather than sent to the Appointed Hour.
  for (const t of active) {
    if (!t.scheduledAt) continue
    if (!watchedSinceScheduled(db, t.id, t.scheduledAt)) continue
    applyTransition(db, t.id, { to: 'eligible', reason: 'auto_reprieve_watched', actor: { system: 'system' }, now })
    await notifier.notify(db, 'reprieved', { id: t.id, episode: t.episode, title: t.title, dueAt: t.dueAt }, now)
    counts.autoReprieved++
  }

  // Re-read: some rows just changed state.
  const stillActive = db.select().from(schema.title).all()

  // 2. Due flip — grace elapsed with no open appeal. A stored, logged transition (actor=sync).
  for (const t of stillActive) {
    if (t.state !== 'scheduled') continue // an appeal blocks the Appointed Hour
    if (!t.dueAt || Date.parse(t.dueAt) > now) continue
    applyTransition(db, t.id, { to: 'due', reason: 'grace_elapsed', actor: { system: 'sync' }, now })
    counts.dueFlipped++
  }

  // 3. Reminder — opt-in, one nudge ~1 day before due. Idempotent via the notification ledger.
  for (const t of stillActive) {
    if (t.state !== 'scheduled' || t.sendReminder !== 1 || !t.dueAt) continue
    const due = Date.parse(t.dueAt)
    if (now >= due - DAY_MS && now < due) {
      const res = await notifier.notify(db, 'reminder', { id: t.id, episode: t.episode, title: t.title, dueAt: t.dueAt }, now)
      counts.remindersSent += res.sent
    }
  }

  return counts
}
