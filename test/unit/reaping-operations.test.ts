import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.REAPARR_DB_PATH = join(mkdtempSync(join(tmpdir(), 'reaparr-ops-')), 'test.db')
const NOW = Date.parse('2026-06-30T00:00:00Z')
const DAY = 86_400_000

async function ctx() {
  const { getDb, schema } = await import('../../server/db/client')
  const { eq, and, isNotNull } = await import('drizzle-orm')
  return { db: getDb(), schema, eq, and, isNotNull }
}
async function ops() {
  return import('../../server/reaping/operations')
}
async function sm() {
  return import('../../server/reaping/stateMachine')
}

let memberId: number
async function freshTitle() {
  const { db, schema, eq } = await ctx()
  const t = db.select().from(schema.title).all()[0]!
  db.update(schema.title)
    .set({ state: 'eligible', episode: 1, scheduledAt: null, dueAt: null, sendReminder: 0, removedAt: null, immortalised: 0 })
    .where(eq(schema.title.id, t.id)).run()
  db.delete(schema.titleTransition).where(eq(schema.titleTransition.titleId, t.id)).run()
  db.delete(schema.reapingNotification).where(eq(schema.reapingNotification.titleId, t.id)).run()
  return t.id
}
async function row(id: number) {
  const { db, schema, eq } = await ctx()
  return db.select().from(schema.title).where(eq(schema.title.id, id)).get()!
}
async function reasons(id: number) {
  const { db, schema, eq } = await ctx()
  return db.select().from(schema.titleTransition).where(eq(schema.titleTransition.titleId, id)).all().map(t => t.reason)
}
async function events(id: number) {
  const { db, schema, eq } = await ctx()
  return db.select().from(schema.reapingNotification).where(eq(schema.reapingNotification.titleId, id)).all().map(n => n.event)
}

beforeAll(async () => {
  const { buildDemoBundle } = await import('../../server/utils/demo-dataset')
  const { persistBundle } = await import('../../server/sync/persist')
  await persistBundle(buildDemoBundle(NOW), NOW)
  // make one person a member with an email so notifications fan out
  const { db, schema, eq, isNotNull } = await ctx()
  const withEmail = db.select({ personId: schema.sourceIdentity.personId }).from(schema.sourceIdentity)
    .where(isNotNull(schema.sourceIdentity.email)).all().map(r => r.personId).filter((x): x is number => x != null)
  memberId = withEmail[0]!
  db.update(schema.person).set({ isMember: 1 }).where(eq(schema.person.id, memberId)).run()
})

describe('reaping operations', () => {
  it('schedules with the default 7-day grace and notifies', async () => {
    const { scheduleTitle } = await ops()
    const { db } = await ctx()
    const id = await freshTitle()
    const res = await scheduleTitle(db, id, { actorPersonId: null }, NOW)
    expect(res.graceDays).toBe(7)
    expect(res.dueAt).toBe(new Date(NOW + 7 * DAY).toISOString())
    expect((await row(id)).state).toBe('scheduled')
    expect(await reasons(id)).toContain('admin_scheduled')
    expect(await events(id)).toContain('scheduled')
    // no session in M1 → the operator action is recorded as an 'operator' actor, not automated 'system'
    const { db: db2, schema, eq } = await ctx()
    const t = db2.select().from(schema.titleTransition).where(eq(schema.titleTransition.titleId, id)).all()
      .find(x => x.reason === 'admin_scheduled')!
    expect(t.actorSystem).toBe('operator')
    expect(t.actorPersonId).toBeNull()
  })

  it('honors a grace override and the opt-in reminder', async () => {
    const { scheduleTitle } = await ops()
    const { db } = await ctx()
    const id = await freshTitle()
    const res = await scheduleTitle(db, id, { graceDays: 3, sendReminder: true, actorPersonId: null }, NOW)
    expect(res.dueAt).toBe(new Date(NOW + 3 * DAY).toISOString())
    expect((await row(id)).sendReminder).toBe(1)
  })

  it('grants an appeal → reprieve (eligible), notifies reprieved, and never touches immortalised', async () => {
    const { scheduleTitle, raiseAppeal, resolveAppeal } = await ops()
    const { db, schema, eq } = await ctx()
    const id = await freshTitle()
    db.update(schema.title).set({ immortalised: 1 }).where(eq(schema.title.id, id)).run()
    await scheduleTitle(db, id, { actorPersonId: null }, NOW)
    raiseAppeal(db, id, memberId, NOW)
    expect((await row(id)).state).toBe('appealed')
    await resolveAppeal(db, id, 'grant', null, NOW)
    const r = await row(id)
    expect(r.state).toBe('eligible')
    expect(r.immortalised).toBe(1) // separate function, untouched
    expect(await events(id)).toContain('reprieved')
  })

  it('denies an appeal → back to scheduled (clock continues)', async () => {
    const { scheduleTitle, raiseAppeal, resolveAppeal } = await ops()
    const { db } = await ctx()
    const id = await freshTitle()
    await scheduleTitle(db, id, { actorPersonId: null }, NOW)
    raiseAppeal(db, id, memberId, NOW)
    await resolveAppeal(db, id, 'deny', null, NOW)
    expect((await row(id)).state).toBe('scheduled')
    expect(await reasons(id)).toContain('appeal_denied')
    // the appellant is notified of the denial
    const { db: db2, schema, eq } = await ctx()
    const denied = db2.select().from(schema.reapingNotification)
      .where(eq(schema.reapingNotification.titleId, id)).all().filter(n => n.event === 'denied')
    expect(denied.length).toBe(1)
    expect(denied[0]!.personId).toBe(memberId)
  })

  it('cancels from due back to eligible', async () => {
    const { scheduleTitle, cancelSchedule } = await ops()
    const { applyTransition } = await sm()
    const { db } = await ctx()
    const id = await freshTitle()
    await scheduleTitle(db, id, { graceDays: 1, actorPersonId: null }, NOW)
    applyTransition(db, id, { to: 'due', reason: 'grace_elapsed', actor: { system: 'sync' }, now: NOW })
    cancelSchedule(db, id, null, NOW)
    expect((await row(id)).state).toBe('eligible')
  })

  it('marks a due title removed and fires departed', async () => {
    const { scheduleTitle, markRemoved } = await ops()
    const { applyTransition } = await sm()
    const { db } = await ctx()
    const id = await freshTitle()
    await scheduleTitle(db, id, { graceDays: 1, actorPersonId: null }, NOW)
    applyTransition(db, id, { to: 'due', reason: 'grace_elapsed', actor: { system: 'sync' }, now: NOW })
    await markRemoved(db, id, null, NOW)
    expect((await row(id)).state).toBe('removed')
    expect(await events(id)).toContain('departed')
  })
})
