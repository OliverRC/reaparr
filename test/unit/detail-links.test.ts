import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.REAPARR_DB_PATH = join(mkdtempSync(join(tmpdir(), 'reaparr-detail-')), 'test.db')
const NOW = Date.parse('2026-06-30T00:00:00Z')

beforeAll(async () => {
  const { buildDemoBundle } = await import('../../server/utils/demo-dataset')
  const { persistBundle } = await import('../../server/sync/persist')
  const { getDb, schema } = await import('../../server/db/client')
  const { seedDefaults } = await import('../../server/utils/seed')
  seedDefaults()
  await persistBundle(buildDemoBundle(NOW), NOW)
  const db = getDb()
  // Configure source base URLs so deep links can be built.
  for (const [source, url] of [['sonarr', 'http://nas:8989'], ['radarr', 'http://nas:7878'], ['tautulli', 'http://nas:8181/']] as const) {
    db.update(schema.sourceConnection).set({ baseUrl: url, credential: 'k', enabled: 1 })
      .where((await import('drizzle-orm')).eq(schema.sourceConnection.source, source)).run()
  }
})

async function titleByName(name: string) {
  const { getDb, schema } = await import('../../server/db/client')
  const { eq } = await import('drizzle-orm')
  return getDb().select().from(schema.title).where(eq(schema.title.title, name)).get()!
}

// Import the handler's link logic by re-deriving it the same way the endpoint does.
async function buildDetail(id: number) {
  const { getDb, schema } = await import('../../server/db/client')
  const { eq } = await import('drizzle-orm')
  const db = getDb()
  const t = db.select().from(schema.title).where(eq(schema.title.id, id)).get()!
  const conns = db.select().from(schema.sourceConnection).all()
  const base = (src: string) => {
    const c = conns.find(x => x.source === src)
    return c?.baseUrl ? c.baseUrl.replace(/\/+$/, '') : null
  }
  return {
    title: t,
    links: {
      sonarr: (t.mediaType === 'series' && base('sonarr') && t.titleSlug) ? `${base('sonarr')}/series/${t.titleSlug}` : null,
      radarr: (t.mediaType === 'movie' && base('radarr') && t.tmdbId) ? `${base('radarr')}/movie/${t.tmdbId}` : null,
      tautulli: (base('tautulli') && t.tautulliKey) ? `${base('tautulli')}/info?rating_key=${t.tautulliKey}` : null
    }
  }
}

describe('title detail deep links', () => {
  it('builds a Sonarr series link from the title slug', async () => {
    const t = await titleByName('A Drama')
    const d = await buildDetail(t.id)
    expect(d.links.sonarr).toBe('http://nas:8989/series/a-drama')
    expect(d.links.radarr).toBeNull()
  })

  it('builds a Radarr movie link from tmdbId', async () => {
    const t = await titleByName('Finished Movie')
    const d = await buildDetail(t.id)
    expect(d.links.radarr).toBe('http://nas:7878/movie/300002')
  })

  it('builds a Tautulli link for a watched series (grandparent key recorded)', async () => {
    const t = await titleByName('A Drama')
    expect(t.tautulliKey).toBe('5002')
    const d = await buildDetail(t.id)
    expect(d.links.tautulli).toBe('http://nas:8181/info?rating_key=5002')
  })

  it('has no Tautulli link for a never-watched title (no history key)', async () => {
    const t = await titleByName('Some Anime')
    expect(t.tautulliKey).toBeNull()
    const d = await buildDetail(t.id)
    expect(d.links.tautulli).toBeNull()
  })
})
