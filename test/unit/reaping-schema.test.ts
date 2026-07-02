import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.REAPARR_DB_PATH = join(mkdtempSync(join(tmpdir(), 'reaparr-lifecycle-')), 'test.db')
const NOW = Date.parse('2026-06-30T00:00:00Z')

async function ctx() {
  const { getDb, schema } = await import('../../server/db/client')
  const { eq } = await import('drizzle-orm')
  return { db: getDb(), schema, eq }
}

beforeAll(async () => {
  const { buildDemoBundle } = await import('../../server/utils/demo-dataset')
  const { persistBundle } = await import('../../server/sync/persist')
  await persistBundle(buildDemoBundle(NOW), NOW)
})

describe('title lifecycle columns', () => {
  it('default to eligible / episode 1 / empty clock for every seeded title', async () => {
    const { db, schema } = await ctx()
    const rows = db.select().from(schema.title).all()
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.state).toBe('eligible')
      expect(r.episode).toBe(1)
      expect(r.scheduledAt).toBeNull()
      expect(r.dueAt).toBeNull()
      expect(r.sendReminder).toBe(0)
      expect(r.removedAt).toBeNull()
    }
  })

  it('survive a re-sync — persistTitles must not reset lifecycle state', async () => {
    const { db, schema, eq } = await ctx()
    const target = db.select().from(schema.title).get()!
    const dueAt = new Date(NOW + 7 * 86400_000).toISOString()
    db.update(schema.title)
      .set({ state: 'scheduled', episode: 2, scheduledAt: new Date(NOW).toISOString(), dueAt, sendReminder: 1 })
      .where(eq(schema.title.id, target.id)).run()

    const { buildDemoBundle } = await import('../../server/utils/demo-dataset')
    const { persistBundle } = await import('../../server/sync/persist')
    await persistBundle(buildDemoBundle(NOW), NOW) // re-sync

    const row = db.select().from(schema.title).where(eq(schema.title.id, target.id)).get()!
    expect(row.state).toBe('scheduled')
    expect(row.episode).toBe(2)
    expect(row.dueAt).toBe(dueAt)
    expect(row.sendReminder).toBe(1)
  })
})
