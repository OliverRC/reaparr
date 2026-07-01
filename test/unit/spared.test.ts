import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.REAPARR_DB_PATH = join(mkdtempSync(join(tmpdir(), 'reaparr-spared-')), 'test.db')
const NOW = Date.parse('2026-06-30T00:00:00Z')

async function ctx() {
  const { getDb, schema } = await import('../../server/db/client')
  const { eq } = await import('drizzle-orm')
  return { db: getDb(), schema, eq }
}
async function titleId(name: string) {
  const { db, schema, eq } = await ctx()
  return db.select().from(schema.title).where(eq(schema.title.title, name)).get()!.id
}
async function spare(name: string, spared: boolean) {
  const { db, schema, eq } = await ctx()
  db.update(schema.title).set({ spared: spared ? 1 : 0, sparedAt: spared ? new Date().toISOString() : null })
    .where(eq(schema.title.title, name)).run()
}

beforeAll(async () => {
  const { buildDemoBundle } = await import('../../server/utils/demo-dataset')
  const { persistBundle } = await import('../../server/sync/persist')
  await persistBundle(buildDemoBundle(NOW), NOW)
})

describe('spared flag', () => {
  it('defaults to unspared for every seeded title', async () => {
    const { db, schema } = await ctx()
    const rows = db.select().from(schema.title).all()
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => r.spared === 0)).toBe(true)
  })

  it('survives a re-sync (persistTitles must not reset it)', async () => {
    await spare('Some Anime', true)
    const { buildDemoBundle } = await import('../../server/utils/demo-dataset')
    const { persistBundle } = await import('../../server/sync/persist')
    await persistBundle(buildDemoBundle(NOW), NOW) // re-sync
    const { db, schema, eq } = await ctx()
    const row = db.select().from(schema.title).where(eq(schema.title.id, await titleId('Some Anime'))).get()!
    expect(row.spared).toBe(1)
    expect(row.sparedAt).toBeTruthy()
  })
})

describe('dashboard behavior with a spared title', () => {
  it('pins the spared title to the bottom under either sort, and excludes it from reclaimable', async () => {
    // "Some Anime" is spared (from the test above) and scores 100 — normally top.
    const { getDashboard } = await import('../../server/utils/dashboard')

    for (const sort of ['score', 'size'] as const) {
      const rows = getDashboard('series', sort)
      const last = rows[rows.length - 1]!
      expect(last.title).toBe('Some Anime')
      expect(last.spared).toBe(true)
      // every non-spared row precedes it
      const idx = rows.findIndex(r => r.title === 'Some Anime')
      expect(rows.slice(0, idx).every(r => !r.spared)).toBe(true)
    }
  })

  it('excludes the spared title from the reclaimable figure and reports it in sparedSize', async () => {
    const { getDashboard } = await import('../../server/utils/dashboard')
    const rows = getDashboard('series', 'score')
    const anime = rows.find(r => r.title === 'Some Anime')!
    const reclaimable = rows.filter(r => !r.spared && r.reapScore >= 50).reduce((a, r) => a + r.sizeOnDisk, 0)
    const sparedSize = rows.filter(r => r.spared).reduce((a, r) => a + r.sizeOnDisk, 0)
    expect(sparedSize).toBe(anime.sizeOnDisk)
    // Some Anime (64GB, score 100) must NOT be counted in reclaimable.
    const reclaimableIncludingAnime = rows.filter(r => r.reapScore >= 50).reduce((a, r) => a + r.sizeOnDisk, 0)
    expect(reclaimable).toBe(reclaimableIncludingAnime - anime.sizeOnDisk)
  })

  it('unsparing returns the title to its score-ranked position', async () => {
    await spare('Some Anime', false)
    const { getDashboard } = await import('../../server/utils/dashboard')
    const rows = getDashboard('series', 'score')
    expect(rows[0]!.title).toBe('Some Anime') // score 100 back on top
    expect(rows[0]!.spared).toBe(false)
  })
})
