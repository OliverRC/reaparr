import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Notifier, NotifyResult } from '../../server/reaping/notifier'

process.env.REAPARR_DB_PATH = join(mkdtempSync(join(tmpdir(), 'reaparr-tick-')), 'test.db')
const NOW = Date.parse('2026-06-30T00:00:00Z')
const DAY = 86_400_000

async function ctx() {
  const { getDb, schema } = await import('../../server/db/client')
  const { eq } = await import('drizzle-orm')
  return { db: getDb(), schema, eq }
}
async function sm() { return import('../../server/reaping/stateMachine') }

// A notifier that records calls instead of sending, so the tick is tested in isolation.
function fakeNotifier() {
  const calls: { event: string, titleId: number }[] = []
  const notifier: Notifier = {
    async notify(_db, event, title): Promise<NotifyResult> {
      calls.push({ event, titleId: title.id })
      return { event, sent: 1, skipped: 0, failed: 0 }
    }
  }
  return { notifier, calls }
}

let pid: number
async function resetAll() {
  const { db, schema } = await ctx()
  db.update(schema.title)
    .set({ state: 'eligible', episode: 1, scheduledAt: null, dueAt: null, sendReminder: 0, removedAt: null }).run()
  db.delete(schema.titleTransition).run()
  db.delete(schema.reapingNotification).run()
  db.delete(schema.watchedItem).run()
}
async function titleIds() {
  const { db, schema } = await ctx()
  return db.select().from(schema.title).all().map(t => t.id)
}
async function schedule(id: number, opts: { scheduledAt: string, dueAt: string, sendReminder?: number }) {
  const { applyTransition } = await sm()
  const { db } = await ctx()
  applyTransition(db, id, {
    to: 'scheduled', reason: 'admin_scheduled', actor: { personId: pid },
    patch: { scheduledAt: opts.scheduledAt, dueAt: opts.dueAt, sendReminder: opts.sendReminder ?? 0 }, now: NOW
  })
}
async function stateOf(id: number) {
  const { db, schema, eq } = await ctx()
  return db.select().from(schema.title).where(eq(schema.title.id, id)).get()!.state
}

beforeAll(async () => {
  const { buildDemoBundle } = await import('../../server/utils/demo-dataset')
  const { persistBundle } = await import('../../server/sync/persist')
  await persistBundle(buildDemoBundle(NOW), NOW)
  const { db, schema } = await ctx()
  pid = db.select().from(schema.person).all()[0]!.id
})

describe('runReapingTick', () => {
  it('flips a past-due scheduled title to `due` (grace_elapsed, actor=sync)', async () => {
    const { runReapingTick } = await import('../../server/reaping/tick')
    const { db, schema, eq } = await ctx()
    await resetAll()
    const id = (await titleIds())[0]!
    await schedule(id, { scheduledAt: new Date(NOW - 8 * DAY).toISOString(), dueAt: new Date(NOW - DAY).toISOString() })

    const { notifier } = fakeNotifier()
    const counts = await runReapingTick(db, NOW, notifier)
    expect(await stateOf(id)).toBe('due')
    expect(counts.dueFlipped).toBe(1)
    const trans = db.select().from(schema.titleTransition).where(eq(schema.titleTransition.titleId, id)).all()
    expect(trans.some(t => t.reason === 'grace_elapsed' && t.actorSystem === 'sync')).toBe(true)
  })

  it('does NOT flip a past-due title with an open appeal', async () => {
    const { runReapingTick } = await import('../../server/reaping/tick')
    const { applyTransition } = await sm()
    const { db } = await ctx()
    await resetAll()
    const id = (await titleIds())[0]!
    await schedule(id, { scheduledAt: new Date(NOW - 8 * DAY).toISOString(), dueAt: new Date(NOW - DAY).toISOString() })
    applyTransition(db, id, { to: 'appealed', reason: 'member_appealed', actor: { personId: pid }, now: NOW })

    const { notifier } = fakeNotifier()
    const counts = await runReapingTick(db, NOW, notifier)
    expect(await stateOf(id)).toBe('appealed') // blocked
    expect(counts.dueFlipped).toBe(0)
  })

  it('auto-reprieves a title watched during grace and notifies reprieved', async () => {
    const { runReapingTick } = await import('../../server/reaping/tick')
    const { db, schema, eq } = await ctx()
    await resetAll()
    const id = (await titleIds())[0]!
    await schedule(id, { scheduledAt: new Date(NOW - 3 * DAY).toISOString(), dueAt: new Date(NOW + 4 * DAY).toISOString() })
    // a watch AFTER it was scheduled
    db.insert(schema.watchedItem).values({ titleId: id, itemKey: 'w1', lastWatchedAt: new Date(NOW - DAY).toISOString(), watchedStatus: 1 }).run()

    const { notifier, calls } = fakeNotifier()
    const counts = await runReapingTick(db, NOW, notifier)
    expect(await stateOf(id)).toBe('eligible')
    expect(counts.autoReprieved).toBe(1)
    expect(calls).toContainEqual({ event: 'reprieved', titleId: id })
    const trans = db.select().from(schema.titleTransition).where(eq(schema.titleTransition.titleId, id)).all()
    expect(trans.some(t => t.reason === 'auto_reprieve_watched' && t.actorSystem === 'system')).toBe(true)
  })

  it('sends the opt-in reminder within ~1 day of due, and only when opted in', async () => {
    const { runReapingTick } = await import('../../server/reaping/tick')
    const { db } = await ctx()
    await resetAll()
    const [optIn, optOut] = await titleIds()
    await schedule(optIn!, { scheduledAt: new Date(NOW - 6 * DAY).toISOString(), dueAt: new Date(NOW + DAY / 2).toISOString(), sendReminder: 1 })
    await schedule(optOut!, { scheduledAt: new Date(NOW - 6 * DAY).toISOString(), dueAt: new Date(NOW + DAY / 2).toISOString(), sendReminder: 0 })

    const { notifier, calls } = fakeNotifier()
    await runReapingTick(db, NOW, notifier)
    const reminders = calls.filter(c => c.event === 'reminder')
    expect(reminders).toContainEqual({ event: 'reminder', titleId: optIn })
    expect(reminders.find(c => c.titleId === optOut)).toBeUndefined()
  })
})

describe('discrepancy detection (persist)', () => {
  it('does not resurrect an admin-marked-removed title that is still present, and counts it', async () => {
    const { applyTransition } = await sm()
    const { buildDemoBundle } = await import('../../server/utils/demo-dataset')
    const { persistBundle } = await import('../../server/sync/persist')
    const { db, schema, eq } = await ctx()
    await resetAll()
    const id = (await titleIds())[0]!
    // schedule → due → admin marks removed (optimistic), but the title is still in the *arr bundle.
    await schedule(id, { scheduledAt: new Date(NOW - 8 * DAY).toISOString(), dueAt: new Date(NOW - DAY).toISOString() })
    applyTransition(db, id, { to: 'due', reason: 'grace_elapsed', actor: { system: 'sync' }, now: NOW })
    applyTransition(db, id, { to: 'removed', reason: 'admin_marked_removed', actor: { personId: pid }, now: NOW })

    const counts = await persistBundle(buildDemoBundle(NOW), NOW) // title still present in the pull
    expect(await stateOf(id)).toBe('removed') // NOT resurrected
    expect(counts.discrepancies).toBeGreaterThanOrEqual(1)
    const trans = db.select().from(schema.titleTransition).where(eq(schema.titleTransition.titleId, id)).all()
    expect(trans.some(t => t.reason === 'resurrected')).toBe(false)
  })
})
