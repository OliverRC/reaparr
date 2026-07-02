import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.REAPARR_DB_PATH = join(mkdtempSync(join(tmpdir(), 'reaparr-sm-')), 'test.db')
const NOW = Date.parse('2026-06-30T00:00:00Z')

async function ctx() {
  const { getDb, schema } = await import('../../server/db/client')
  const { eq } = await import('drizzle-orm')
  return { db: getDb(), schema, eq }
}
async function sm() {
  return import('../../server/reaping/stateMachine')
}
async function freshTitle() {
  // Grab a title and reset it to a clean eligible baseline for the test.
  const { db, schema, eq } = await ctx()
  const t = db.select().from(schema.title).all()[0]!
  db.update(schema.title)
    .set({ state: 'eligible', episode: 1, removedAt: null, scheduledAt: null, dueAt: null, sendReminder: 0, spared: 0 })
    .where(eq(schema.title.id, t.id)).run()
  db.delete(schema.titleTransition).where(eq(schema.titleTransition.titleId, t.id)).run()
  return t.id
}
async function personId() {
  const { db, schema } = await ctx()
  return db.select().from(schema.person).all()[0]!.id
}
async function stateOf(id: number) {
  const { db, schema, eq } = await ctx()
  return db.select().from(schema.title).where(eq(schema.title.id, id)).get()!
}
async function transitionCount(id: number) {
  const { db, schema, eq } = await ctx()
  return db.select().from(schema.titleTransition).where(eq(schema.titleTransition.titleId, id)).all().length
}

beforeAll(async () => {
  const { buildDemoBundle } = await import('../../server/utils/demo-dataset')
  const { persistBundle } = await import('../../server/sync/persist')
  await persistBundle(buildDemoBundle(NOW), NOW)
})

describe('applyTransition', () => {
  it('drives the full happy-path lifecycle and logs each step', async () => {
    const { applyTransition } = await sm()
    const { db } = await ctx()
    const id = await freshTitle()
    const pid = await personId()

    applyTransition(db, id, { to: 'scheduled', reason: 'admin_scheduled', actor: { personId: pid },
      patch: { scheduledAt: new Date(NOW).toISOString(), dueAt: new Date(NOW + 7 * 86400_000).toISOString(), sendReminder: 0 }, now: NOW })
    expect((await stateOf(id)).state).toBe('scheduled')

    applyTransition(db, id, { to: 'appealed', reason: 'member_appealed', actor: { personId: pid }, now: NOW })
    expect((await stateOf(id)).state).toBe('appealed')

    applyTransition(db, id, { to: 'scheduled', reason: 'appeal_denied', actor: { personId: pid }, now: NOW })
    applyTransition(db, id, { to: 'due', reason: 'grace_elapsed', actor: { system: 'sync' }, now: NOW })
    expect((await stateOf(id)).state).toBe('due')

    applyTransition(db, id, { to: 'removed', reason: 'admin_marked_removed', actor: { personId: pid }, now: NOW })
    const removed = await stateOf(id)
    expect(removed.state).toBe('removed')
    expect(removed.removedAt).toBeTruthy()

    // Resurrection increments the episode and clears the tombstone/clock.
    applyTransition(db, id, { to: 'eligible', reason: 'resurrected', actor: { system: 'sync' }, now: NOW })
    const revived = await stateOf(id)
    expect(revived.state).toBe('eligible')
    expect(revived.episode).toBe(2)
    expect(revived.removedAt).toBeNull()
    expect(revived.dueAt).toBeNull()

    expect(await transitionCount(id)).toBe(6)
  })

  it('rejects an illegal transition and writes nothing', async () => {
    const { applyTransition } = await sm()
    const { db } = await ctx()
    const id = await freshTitle()
    const before = await transitionCount(id)
    expect(() => applyTransition(db, id, { to: 'due', reason: 'grace_elapsed', actor: { system: 'sync' }, now: NOW }))
      .toThrow(/Illegal transition/)
    expect(await transitionCount(id)).toBe(before)
    expect((await stateOf(id)).state).toBe('eligible')
  })

  it('enforces the actor invariant (exactly one of person/system)', async () => {
    const { applyTransition } = await sm()
    const { db } = await ctx()
    const id = await freshTitle()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => applyTransition(db, id, { to: 'scheduled', reason: 'admin_scheduled', actor: {} as any, now: NOW }))
      .toThrow(/actor/)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => applyTransition(db, id, { to: 'scheduled', reason: 'admin_scheduled', actor: { personId: 1, system: 'system' } as any, now: NOW }))
      .toThrow(/actor/)
  })

  it('the denormalized state always equals the latest transition to_state', async () => {
    const { applyTransition } = await sm()
    const { db, schema, eq } = await ctx()
    const id = await freshTitle()
    const pid = await personId()
    applyTransition(db, id, { to: 'scheduled', reason: 'admin_scheduled', actor: { personId: pid }, now: NOW })
    const latest = db.select().from(schema.titleTransition).where(eq(schema.titleTransition.titleId, id)).all().at(-1)!
    expect((await stateOf(id)).state).toBe(latest.toState)
    expect((await stateOf(id)).episode).toBe(latest.episode)
  })

  it('granting an appeal does not touch the separate spared flag', async () => {
    const { applyTransition } = await sm()
    const { db, schema, eq } = await ctx()
    const id = await freshTitle()
    const pid = await personId()
    db.update(schema.title).set({ spared: 1 }).where(eq(schema.title.id, id)).run()
    applyTransition(db, id, { to: 'scheduled', reason: 'admin_scheduled', actor: { personId: pid }, now: NOW })
    applyTransition(db, id, { to: 'appealed', reason: 'member_appealed', actor: { personId: pid }, now: NOW })
    applyTransition(db, id, { to: 'eligible', reason: 'appeal_granted', actor: { personId: pid }, now: NOW })
    expect((await stateOf(id)).spared).toBe(1) // untouched
  })
})
