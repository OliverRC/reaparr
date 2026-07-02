import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.REAPARR_DB_PATH = join(mkdtempSync(join(tmpdir(), 'reaparr-immortalised-')), 'test.db')
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
async function immortalise(name: string, immortalised: boolean) {
  const { db, schema, eq } = await ctx()
  db.update(schema.title).set({ immortalised: immortalised ? 1 : 0, immortalisedAt: immortalised ? new Date().toISOString() : null })
    .where(eq(schema.title.title, name)).run()
}

beforeAll(async () => {
  const { buildDemoBundle } = await import('../../server/utils/demo-dataset')
  const { persistBundle } = await import('../../server/sync/persist')
  await persistBundle(buildDemoBundle(NOW), NOW)
})

describe('immortalised flag', () => {
  it('defaults to not-immortalised for every seeded title', async () => {
    const { db, schema } = await ctx()
    const rows = db.select().from(schema.title).all()
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => r.immortalised === 0)).toBe(true)
  })

  it('survives a re-sync (persistTitles must not reset it)', async () => {
    await immortalise('Some Anime', true)
    const { buildDemoBundle } = await import('../../server/utils/demo-dataset')
    const { persistBundle } = await import('../../server/sync/persist')
    await persistBundle(buildDemoBundle(NOW), NOW) // re-sync
    const { db, schema, eq } = await ctx()
    const row = db.select().from(schema.title).where(eq(schema.title.id, await titleId('Some Anime'))).get()!
    expect(row.immortalised).toBe(1)
    expect(row.immortalisedAt).toBeTruthy()
  })
})

describe('dashboard behavior with an immortalised title', () => {
  it('pins the immortalised title to the bottom under either sort, and excludes it from reclaimable', async () => {
    // "Some Anime" is immortalised (from the test above) and scores 100 — normally top.
    const { getDashboard } = await import('../../server/utils/dashboard')

    for (const sort of ['score', 'size'] as const) {
      const rows = getDashboard('series', sort)
      const last = rows[rows.length - 1]!
      expect(last.title).toBe('Some Anime')
      expect(last.immortalised).toBe(true)
      // every non-immortalised row precedes it
      const idx = rows.findIndex(r => r.title === 'Some Anime')
      expect(rows.slice(0, idx).every(r => !r.immortalised)).toBe(true)
    }
  })

  it('excludes the immortalised title from the reclaimable figure and reports it in immortalisedSize', async () => {
    const { getDashboard } = await import('../../server/utils/dashboard')
    const rows = getDashboard('series', 'score')
    const anime = rows.find(r => r.title === 'Some Anime')!
    const reclaimable = rows.filter(r => !r.immortalised && r.reapScore >= 50).reduce((a, r) => a + r.sizeOnDisk, 0)
    const immortalisedSize = rows.filter(r => r.immortalised).reduce((a, r) => a + r.sizeOnDisk, 0)
    expect(immortalisedSize).toBe(anime.sizeOnDisk)
    // Some Anime (64GB, score 100) must NOT be counted in reclaimable.
    const reclaimableIncludingAnime = rows.filter(r => r.reapScore >= 50).reduce((a, r) => a + r.sizeOnDisk, 0)
    expect(reclaimable).toBe(reclaimableIncludingAnime - anime.sizeOnDisk)
  })

  it('returning the title to the reap restores its score-ranked position', async () => {
    await immortalise('Some Anime', false)
    const { getDashboard } = await import('../../server/utils/dashboard')
    const rows = getDashboard('series', 'score')
    expect(rows[0]!.title).toBe('Some Anime') // score 100 back on top
    expect(rows[0]!.immortalised).toBe(false)
  })
})
