import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SyncBundle } from '../../server/sync/persist'

process.env.REAPARR_DB_PATH = join(mkdtempSync(join(tmpdir(), 'reaparr-fetchguard-')), 'test.db')
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
async function counts() {
  const { db, schema } = await ctx()
  const n = (t: unknown) => (db.select().from(t as never).all() as unknown[]).length
  return {
    requests: n(schema.request),
    watchedItems: n(schema.watchedItem),
    titleWatchers: n(schema.titleWatcher),
    identities: n(schema.sourceIdentity),
    persons: n(schema.person)
  }
}

beforeAll(async () => {
  await persist(await base())
})

describe('sync fetch-guard (non-title tables)', () => {
  it('a full seed populates every derived table', async () => {
    const c = await counts()
    expect(c.requests).toBeGreaterThan(0)
    expect(c.watchedItems).toBeGreaterThan(0)
    expect(c.identities).toBeGreaterThan(0)
    expect(c.persons).toBeGreaterThan(0)
  })

  it('a failed Seerr fetch preserves requests and seerr identities', async () => {
    const { db, schema, eq } = await ctx()
    const before = await counts()
    const seerrBefore = db.select().from(schema.sourceIdentity).where(eq(schema.sourceIdentity.source, 'seerr')).all().length
    expect(seerrBefore).toBeGreaterThan(0)

    // Seerr "failed": nothing fetched AND not authoritative.
    const b = await base()
    await persist({ ...b, requests: [], seerrUsers: [], sourcesOk: { sonarr: true, radarr: true, seerr: false, tautulli: true } })

    const after = await counts()
    expect(after.requests).toBe(before.requests) // requests preserved exactly — not wiped
    // No identity LOSS: seerr rows preserved verbatim; tautulli rebuilt at the same count. (Persons
    // may split when a cross-source auto-merge can't be recomputed with Seerr down — no data lost.)
    expect(after.identities).toBe(before.identities)
    expect(after.persons).toBeGreaterThanOrEqual(before.persons)
    expect(db.select().from(schema.sourceIdentity).where(eq(schema.sourceIdentity.source, 'seerr')).all().length).toBe(seerrBefore)
  })

  it('a failed Tautulli fetch preserves watch rows', async () => {
    const before = await counts()
    const b = await base()
    await persist({ ...b, history: [], tautulliUsers: [], sourcesOk: { sonarr: true, radarr: true, seerr: true, tautulli: false } })

    const after = await counts()
    expect(after.watchedItems).toBe(before.watchedItems)
    expect(after.titleWatchers).toBe(before.titleWatchers)
  })

  it('both people sources failing leaves identities and persons untouched', async () => {
    const before = await counts()
    const b = await base()
    await persist({
      ...b, seerrUsers: [], tautulliUsers: [], requests: [], history: [],
      sourcesOk: { sonarr: true, radarr: true, seerr: false, tautulli: false }
    })

    const after = await counts()
    expect(after.identities).toBe(before.identities)
    expect(after.persons).toBe(before.persons)
  })

  it('an admin flag (isMember) survives a failed people-source sync', async () => {
    const { db, schema, eq } = await ctx()
    // Flag the person owning a seerr identity as a member. With Seerr down, that identity (and so
    // its person) is preserved in place, so the flag stays put on the same row.
    const seerrIdentity = db.select().from(schema.sourceIdentity).where(eq(schema.sourceIdentity.source, 'seerr')).all()[0]!
    const pid = seerrIdentity.personId!
    db.update(schema.person).set({ isMember: 1 }).where(eq(schema.person.id, pid)).run()

    const b = await base()
    await persist({ ...b, requests: [], seerrUsers: [], sourcesOk: { sonarr: true, radarr: true, seerr: false, tautulli: true } })

    const after = db.select().from(schema.person).where(eq(schema.person.id, pid)).get()!
    expect(after.isMember).toBe(1)
  })
})
