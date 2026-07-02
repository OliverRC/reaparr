import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.REAPARR_DB_PATH = join(mkdtempSync(join(tmpdir(), 'reaparr-notif-')), 'test.db')
const NOW = Date.parse('2026-06-30T00:00:00Z')

async function ctx() {
  const { getDb, schema } = await import('../../server/db/client')
  const { eq, and, isNotNull } = await import('drizzle-orm')
  return { db: getDb(), schema, eq, and, isNotNull }
}

// person ids that have a resolvable email, in id order
async function membersWithEmail() {
  const { db, schema, isNotNull } = await ctx()
  const ids = db.select({ personId: schema.sourceIdentity.personId }).from(schema.sourceIdentity)
    .where(isNotNull(schema.sourceIdentity.email)).all()
    .map(r => r.personId).filter((x): x is number => x != null)
  return [...new Set(ids)].sort((a, b) => a - b)
}

let memberA: number, memberB: number, hiddenMember: number

beforeAll(async () => {
  const { buildDemoBundle } = await import('../../server/utils/demo-dataset')
  const { persistBundle } = await import('../../server/sync/persist')
  await persistBundle(buildDemoBundle(NOW), NOW)

  const { db, schema, eq } = await ctx()
  const withEmail = await membersWithEmail()
  expect(withEmail.length).toBeGreaterThanOrEqual(3)
  ;[memberA, memberB, hiddenMember] = withEmail as [number, number, number]
  db.update(schema.person).set({ isMember: 1 }).where(eq(schema.person.id, memberA)).run()
  db.update(schema.person).set({ isMember: 1 }).where(eq(schema.person.id, memberB)).run()
  db.update(schema.person).set({ isMember: 1, isHidden: 1 }).where(eq(schema.person.id, hiddenMember)).run()
  // everyone else stays a non-member
})

async function aTitle() {
  const { db, schema } = await ctx()
  return db.select().from(schema.title).all()[0]!
}

describe('selectRecipients', () => {
  it('returns members-with-email only; excludes hidden members and non-members', async () => {
    const { selectRecipients } = await import('../../server/reaping/notifier')
    const { db } = await ctx()
    const ids = selectRecipients(db).map(r => r.personId).sort((a, b) => a - b)
    expect(ids).toEqual([memberA, memberB])
    expect(ids).not.toContain(hiddenMember)
  })
})

describe('EmailNotifier', () => {
  it('logs one sent row per recipient (log-only fallback when no SMTP configured)', async () => {
    const { emailNotifier } = await import('../../server/reaping/notifier')
    const { db, schema, eq, and } = await ctx()
    const t = await aTitle()
    const res = await emailNotifier.notify(db, 'scheduled', { id: t.id, episode: t.episode, title: t.title, dueAt: t.dueAt }, NOW)
    expect(res.sent).toBe(2)
    expect(res.failed).toBe(0)
    const rows = db.select().from(schema.reapingNotification)
      .where(and(eq(schema.reapingNotification.titleId, t.id), eq(schema.reapingNotification.event, 'scheduled'))).all()
    expect(rows.length).toBe(2)
    expect(rows.every(r => r.status === 'sent')).toBe(true)
    expect(rows.every(r => JSON.parse(r.metadata!).transport === 'log')).toBe(true)
  })

  it('is idempotent — re-notifying the same (title, episode, event) does not double-send', async () => {
    const { emailNotifier } = await import('../../server/reaping/notifier')
    const { db, schema, eq, and } = await ctx()
    const t = await aTitle()
    const res = await emailNotifier.notify(db, 'scheduled', { id: t.id, episode: t.episode, title: t.title, dueAt: t.dueAt }, NOW)
    expect(res.sent).toBe(0)
    expect(res.skipped).toBe(2)
    const rows = db.select().from(schema.reapingNotification)
      .where(and(eq(schema.reapingNotification.titleId, t.id), eq(schema.reapingNotification.event, 'scheduled'))).all()
    expect(rows.length).toBe(2) // no new rows
  })

  it('targets only the given persons (denied → appellant only, not all members)', async () => {
    const { emailNotifier } = await import('../../server/reaping/notifier')
    const { db, schema, eq, and } = await ctx()
    const t = await aTitle()
    const res = await emailNotifier.notify(db, 'denied', { id: t.id, episode: t.episode, title: t.title, dueAt: t.dueAt }, NOW, { targetPersonIds: [memberA] })
    expect(res.sent).toBe(1)
    const rows = db.select().from(schema.reapingNotification)
      .where(and(eq(schema.reapingNotification.titleId, t.id), eq(schema.reapingNotification.event, 'denied'))).all()
    expect(rows.length).toBe(1)
    expect(rows[0]!.personId).toBe(memberA)
    expect(rows.some(r => r.personId === memberB)).toBe(false)
  })

  it('sends nothing when notifications are disabled', async () => {
    const { emailNotifier } = await import('../../server/reaping/notifier')
    const { db, schema, eq, and } = await ctx()
    db.insert(schema.appSetting).values({ key: 'notifications_enabled', value: '0' })
      .onConflictDoUpdate({ target: schema.appSetting.key, set: { value: '0' } }).run()
    const t = await aTitle()
    const res = await emailNotifier.notify(db, 'reprieved', { id: t.id, episode: t.episode, title: t.title, dueAt: t.dueAt }, NOW)
    expect(res.sent).toBe(0)
    const rows = db.select().from(schema.reapingNotification)
      .where(and(eq(schema.reapingNotification.titleId, t.id), eq(schema.reapingNotification.event, 'reprieved'))).all()
    expect(rows.length).toBe(0)
    db.delete(schema.appSetting).where(eq(schema.appSetting.key, 'notifications_enabled')).run() // restore default
  })

  it('records failed rows (without throwing) when SMTP is configured but unreachable', async () => {
    const { emailNotifier } = await import('../../server/reaping/notifier')
    const { db, schema, eq, and } = await ctx()
    // Configure SMTP → mailer takes the smtp branch, which fails (nodemailer not installed / host bogus).
    db.insert(schema.appSetting).values({ key: 'smtp_host', value: 'smtp.invalid.example' }).onConflictDoUpdate({ target: schema.appSetting.key, set: { value: 'smtp.invalid.example' } }).run()
    db.insert(schema.appSetting).values({ key: 'smtp_from', value: 'death@reaparr.test' }).onConflictDoUpdate({ target: schema.appSetting.key, set: { value: 'death@reaparr.test' } }).run()
    const t = await aTitle()
    const res = await emailNotifier.notify(db, 'departed', { id: t.id, episode: t.episode, title: t.title, dueAt: t.dueAt }, NOW)
    expect(res.failed).toBe(2)
    expect(res.sent).toBe(0)
    const rows = db.select().from(schema.reapingNotification)
      .where(and(eq(schema.reapingNotification.titleId, t.id), eq(schema.reapingNotification.event, 'departed'))).all()
    expect(rows.every(r => r.status === 'failed')).toBe(true)
  })
})
