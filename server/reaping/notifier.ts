// Reaping notifications (docs/adr/0004). A channel-agnostic Notifier interface; M1 ships the
// per-recipient EmailNotifier. Audience = all members (is_member, not hidden) with a resolvable
// email — the operator is included. Every send is logged to reaping_notification for idempotency
// and admin visibility. A broadcast channel (Discord) lands in M2 and would send once with
// personId=null; the interface must not assume "notify" means "loop over people".

import { and, eq, isNotNull } from 'drizzle-orm'
import type { getDb } from '../db/client'
import { schema } from '../db/client'
import { sendMail } from './mailer'

type Db = ReturnType<typeof getDb>

export type NotificationEvent = 'scheduled' | 'reminder' | 'reprieved' | 'departed'

export interface Recipient {
  personId: number
  email: string
  displayName: string
}

export interface NotifyTitle {
  id: number
  episode: number
  title: string
  dueAt: string | null
}

export interface NotifyResult {
  event: NotificationEvent
  sent: number
  skipped: number // already sent (idempotent)
  failed: number
}

export interface Notifier {
  notify(db: Db, event: NotificationEvent, title: NotifyTitle, now?: number): Promise<NotifyResult>
}

// All members (not hidden) that have a resolvable email. Operator included — they can unset their
// own is_member if they don't want the mail.
export function selectRecipients(db: Db): Recipient[] {
  const members = db.select().from(schema.person)
    .where(and(eq(schema.person.isMember, 1), eq(schema.person.isHidden, 0))).all()
  const out: Recipient[] = []
  for (const m of members) {
    const idn = db.select({ email: schema.sourceIdentity.email }).from(schema.sourceIdentity)
      .where(and(eq(schema.sourceIdentity.personId, m.id), isNotNull(schema.sourceIdentity.email))).get()
    if (idn?.email) out.push({ personId: m.id, email: idn.email, displayName: m.displayName })
  }
  return out
}

function daysUntil(dueAt: string | null, now: number): number {
  if (!dueAt) return 0
  return Math.max(0, Math.ceil((Date.parse(dueAt) - now) / 86400_000))
}

// Server-side email copy in Death's register (§11). This is a presentation surface, so voiced copy
// is appropriate here; it is written inline, never imported from the frontend voice map, and never
// applied to stored/transmitted data.
function composeEmail(event: NotificationEvent, title: NotifyTitle, now: number): { subject: string, body: string } {
  const subject = `CONCERNING ${title.title.toUpperCase()}`
  switch (event) {
    case 'scheduled': {
      const n = daysUntil(title.dueAt, now)
      return { subject, body: `IT HAS GONE UNWATCHED. IT IS DUE TO PASS IN ${n} DAY${n === 1 ? '' : 'S'}. IF YOU WOULD SPEAK FOR IT, DO SO IN REAPARR.` }
    }
    case 'reminder': {
      const n = daysUntil(title.dueAt, now)
      return { subject, body: `THE SANDS RUN LOW. ${n} DAY${n === 1 ? '' : 'S'} REMAIN. SPEAK NOW, OR LET IT PASS.` }
    }
    case 'reprieved':
      return { subject, body: 'IT WILL STAY. FOR NOW.' }
    case 'departed':
      return { subject, body: 'IT HAS PASSED.' }
  }
}

// Has this exact (title, episode, event, person) already been sent? Keeps re-runs idempotent.
function alreadySent(db: Db, titleId: number, episode: number, event: NotificationEvent, personId: number): boolean {
  const row = db.select({ id: schema.reapingNotification.id }).from(schema.reapingNotification)
    .where(and(
      eq(schema.reapingNotification.titleId, titleId),
      eq(schema.reapingNotification.episode, episode),
      eq(schema.reapingNotification.event, event),
      eq(schema.reapingNotification.personId, personId),
      eq(schema.reapingNotification.status, 'sent')
    )).get()
  return !!row
}

export class EmailNotifier implements Notifier {
  async notify(db: Db, event: NotificationEvent, title: NotifyTitle, now: number = Date.now()): Promise<NotifyResult> {
    const recipients = selectRecipients(db)
    const nowIso = new Date(now).toISOString()
    const result: NotifyResult = { event, sent: 0, skipped: 0, failed: 0 }
    const { subject, body } = composeEmail(event, title, now)

    for (const r of recipients) {
      if (alreadySent(db, title.id, title.episode, event, r.personId)) {
        result.skipped++
        continue
      }
      const mail = await sendMail(db, { to: r.email, subject, body })
      db.insert(schema.reapingNotification).values({
        titleId: title.id,
        episode: title.episode,
        event,
        channel: 'email',
        personId: r.personId,
        status: mail.ok ? 'sent' : 'failed',
        sentAt: nowIso,
        metadata: JSON.stringify({ email: r.email, transport: mail.transport, ...(mail.error ? { error: mail.error } : {}) })
      }).run()
      if (mail.ok) result.sent++
      else result.failed++
    }
    return result
  }
}

// Default notifier for M1.
export const emailNotifier = new EmailNotifier()
