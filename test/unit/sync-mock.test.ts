import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Full sync against the mock source server — the M3 / §12.3 self-validating path:
// probe + sync run green with ZERO real credentials, all four auth shapes exercised.

process.env.REAPARR_DB_PATH = join(mkdtempSync(join(tmpdir(), 'reaparr-sync-')), 'test.db')

const NOW = Date.parse('2026-06-30T00:00:00Z')
const PORT = 8911
const BASE = `http://localhost:${PORT}`
let mock: ChildProcess

async function waitForServer(url: string, attempts = 50) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('mock server did not start')
}

beforeAll(async () => {
  mock = spawn('node', ['test/mock-server/server.mjs'], {
    env: { ...process.env, MOCK_PORT: String(PORT), MOCK_NOW: String(NOW) },
    stdio: 'ignore'
  })
  await waitForServer(`${BASE}/api/v3/system/status`)

  const { getDb, schema } = await import('../../server/db/client')
  const { seedDefaults } = await import('../../server/utils/seed')
  seedDefaults()
  const db = getDb()
  for (const source of ['sonarr', 'radarr', 'seerr', 'tautulli']) {
    db.update(schema.sourceConnection)
      .set({ baseUrl: BASE, credential: 'mock-key', enabled: 1 })
      .where((await import('drizzle-orm')).eq(schema.sourceConnection.source, source)).run()
  }
}, 20000)

afterAll(() => { mock?.kill() })

describe('probe against the mock server (all four auth shapes)', () => {
  it('each source probes ok', async () => {
    const { createSonarrClient, createRadarrClient, createSeerrClient, createTautulliClient } = await import('../../server/sources')
    const cfg = { baseUrl: BASE, credential: 'mock-key' }
    expect((await createSonarrClient(cfg).probe()).ok).toBe(true)
    expect((await createRadarrClient(cfg).probe()).ok).toBe(true)
    expect((await createSeerrClient(cfg).probe()).ok).toBe(true)
    expect((await createTautulliClient(cfg).probe()).ok).toBe(true)
  })
})

describe('full sync run', () => {
  it('runs ok and populates titles/people/scores end-to-end', async () => {
    const { runSync } = await import('../../server/sync/run')
    const { getDb, schema } = await import('../../server/db/client')
    const { eq } = await import('drizzle-orm')

    const result = await runSync(NOW)
    expect(result.status).toBe('ok')

    const db = getDb()
    const scoreFor = (name: string) => {
      const t = db.select().from(schema.title).where(eq(schema.title.title, name)).get()
      return db.select().from(schema.score).where(eq(schema.score.titleId, t!.id)).get()!.reapScore
    }
    expect(scoreFor('Some Anime')).toBe(100)
    expect(scoreFor('A Drama')).toBe(68)
    expect(scoreFor('A Comedy')).toBe(0)
    expect(scoreFor('Never Watched Movie')).toBe(100)
    expect(scoreFor('Abandoned Movie')).toBe(48)
    expect(scoreFor('Finished Movie')).toBe(0)

    // Sizes round-tripped through the Sonarr/Radarr shape correctly.
    const anime = db.select().from(schema.title).where(eq(schema.title.title, 'Some Anime')).get()!
    expect(anime.sizeOnDisk).toBe(64 * 1024 * 1024 * 1024)

    // Identity: Alice links both sources via the mock payloads.
    const alice = db.select().from(schema.person).where(eq(schema.person.displayName, 'Alice A')).get()
    expect(alice).toBeTruthy()
  }, 20000)
})
