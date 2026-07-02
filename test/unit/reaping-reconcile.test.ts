import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SyncBundle } from '../../server/sync/persist'

process.env.REAPARR_DB_PATH = join(mkdtempSync(join(tmpdir(), 'reaparr-reconcile-')), 'test.db')
const NOW = Date.parse('2026-06-30T00:00:00Z')

async function ctx() {
  const { getDb, schema } = await import('../../server/db/client')
  const { eq } = await import('drizzle-orm')
  return { db: getDb(), schema, eq }
}
async function persist(bundle: SyncBundle) {
  const { persistBundle } = await import('../../server/sync/persist')
  await persistBundle(bundle, NOW)
}
async function base(): Promise<SyncBundle> {
  const { buildDemoBundle } = await import('../../server/utils/demo-dataset')
  return buildDemoBundle(NOW)
}
async function titleRow(name: string) {
  const { db, schema, eq } = await ctx()
  return db.select().from(schema.title).where(eq(schema.title.title, name)).get()
}

beforeAll(async () => {
  await persist(await base())
})

describe('sync reconciliation (tombstone model)', () => {
  it('fetch-guard: a failed/empty Sonarr fetch removes nothing', async () => {
    const { db, schema } = await ctx()
    const seriesBefore = db.select().from(schema.title).all().filter(t => t.source === 'sonarr').length
    expect(seriesBefore).toBeGreaterThan(0)

    const b = await base()
    // Sonarr "failed": no series fetched AND not authoritative.
    await persist({ ...b, series: [], sourcesOk: { sonarr: false, radarr: true } })

    const rows = db.select().from(schema.title).all()
    const seriesAfter = rows.filter(t => t.source === 'sonarr').length
    expect(seriesAfter).toBe(seriesBefore)
    expect(rows.filter(t => t.source === 'sonarr').every(t => t.state !== 'removed')).toBe(true)
  })

  it('soft-close: a scheduled title gone from an authoritative source is tombstoned, not deleted', async () => {
    const { db, schema, eq } = await ctx()
    const { applyTransition } = await import('../../server/reaping/stateMachine')
    // restore full state, then schedule "A Drama"
    await persist(await base())
    const drama = (await titleRow('A Drama'))!
    const pid = db.select().from(schema.person).all()[0]!.id
    applyTransition(db, drama.id, { to: 'scheduled', reason: 'admin_scheduled', actor: { personId: pid },
      patch: { scheduledAt: new Date(NOW).toISOString(), dueAt: new Date(NOW + 7 * 86400_000).toISOString() }, now: NOW })
    const seasonsBefore = db.select().from(schema.season).where(eq(schema.season.titleId, drama.id)).all().length
    expect(seasonsBefore).toBeGreaterThan(0)

    // Sonarr authoritative, but "A Drama" is gone from the pull.
    const b = await base()
    await persist({ ...b, series: b.series.filter(s => s.title !== 'A Drama') })

    const after = db.select().from(schema.title).where(eq(schema.title.id, drama.id)).get()!
    expect(after.state).toBe('removed')
    expect(after.removedAt).toBeTruthy()
    // children retained (not cascade-deleted)
    expect(db.select().from(schema.season).where(eq(schema.season.titleId, drama.id)).all().length).toBe(seasonsBefore)
    // a sync_confirmed_removed transition was logged
    const trans = db.select().from(schema.titleTransition).where(eq(schema.titleTransition.titleId, drama.id)).all()
    expect(trans.some(t => t.reason === 'sync_confirmed_removed' && t.actorSystem === 'sync')).toBe(true)
    // tombstoned titles hold no live score
    expect(db.select().from(schema.score).where(eq(schema.score.titleId, drama.id)).get()).toBeUndefined()
  })

  it('resurrection: re-adding the title under a NEW *arr id reactivates the same row as a new episode', async () => {
    const { db, schema, eq } = await ctx()
    const dramaBefore = (await titleRow('A Drama'))!
    expect(dramaBefore.state).toBe('removed')
    expect(dramaBefore.episode).toBe(1)

    // Re-add "A Drama" with a fresh Sonarr id (a re-request produces a new *arr entry, same tvdbId).
    const b = await base()
    const NEW_ID = 987
    await persist({ ...b, series: b.series.map(s => s.title === 'A Drama' ? { ...s, sourceId: NEW_ID } : s) })

    const after = db.select().from(schema.title).where(eq(schema.title.id, dramaBefore.id)).get()!
    expect(after.id).toBe(dramaBefore.id) // same identity row
    expect(after.state).toBe('eligible')
    expect(after.episode).toBe(2) // new life
    expect(after.sourceId).toBe(NEW_ID) // adopts the new *arr id
    expect(after.removedAt).toBeNull()
    // fresh score recomputed for the new episode
    expect(db.select().from(schema.score).where(eq(schema.score.titleId, after.id)).get()).toBeTruthy()
    // a resurrected transition was logged, old history retained
    const trans = db.select().from(schema.titleTransition).where(eq(schema.titleTransition.titleId, after.id)).all()
    expect(trans.some(t => t.reason === 'resurrected')).toBe(true)
    expect(trans.some(t => t.reason === 'sync_confirmed_removed')).toBe(true) // Life 1 history kept
  })
})
