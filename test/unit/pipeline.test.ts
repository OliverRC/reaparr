import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Isolate the DB to a temp file BEFORE the client opens it (path is read lazily).
process.env.REAPARR_DB_PATH = join(mkdtempSync(join(tmpdir(), 'reaparr-')), 'test.db')

const NOW = Date.parse('2026-06-30T00:00:00Z')

let rows: Record<string, { reap: number, size: number, mediaType: string, seasons: number | null }> = {}

beforeAll(async () => {
  const { buildDemoBundle } = await import('../../server/utils/demo-dataset')
  const { persistBundle } = await import('../../server/sync/persist')
  const { getDb, schema } = await import('../../server/db/client')

  await persistBundle(buildDemoBundle(NOW), NOW)

  const { eq } = await import('drizzle-orm')
  const db = getDb()
  rows = {}
  const titles = db.select().from(schema.title).all()
  for (const t of titles) {
    const s = db.select().from(schema.score).where(eq(schema.score.titleId, t.id)).get()
    rows[t.title] = { reap: s!.reapScore, size: t.sizeOnDisk, mediaType: t.mediaType, seasons: t.seasonCount }
  }
})

const GB = 1024 * 1024 * 1024

describe('end-to-end pipeline on demo dataset', () => {
  it('computes the expected series Reap Scores', () => {
    expect(rows['Some Anime']!.reap).toBe(100)
    expect(rows['Dormant Unrequested']!.reap).toBe(80)
    expect(rows['A Drama']!.reap).toBe(68)
    expect(rows['Stale Series']!.reap).toBe(38)
    expect(rows['Ongoing Show']!.reap).toBe(15)
    expect(rows['A Comedy']!.reap).toBe(0)
  })

  it('computes the expected movie Reap Scores', () => {
    expect(rows['Never Watched Movie']!.reap).toBe(100)
    expect(rows['Big Unwatched Movie']!.reap).toBe(80)
    expect(rows['Abandoned Movie']!.reap).toBe(48)
    expect(rows['Finished Movie']!.reap).toBe(0)
  })

  it('records correct sizes on disk', () => {
    expect(rows['Some Anime']!.size).toBe(64 * GB)
    expect(rows['Big Unwatched Movie']!.size).toBe(60 * GB)
    expect(rows['A Drama']!.size).toBe(41 * GB)
  })

  it('tracks season counts for series only', () => {
    expect(rows['Some Anime']!.seasons).toBe(3)
    expect(rows['A Drama']!.seasons).toBe(5)
    expect(rows['Never Watched Movie']!.seasons).toBeNull()
  })
})

describe('identity resolution on demo dataset', () => {
  it('creates one canonical Alice linking Seerr + Tautulli', async () => {
    const { getDb, schema } = await import('../../server/db/client')
    const { eq } = await import('drizzle-orm')
    const db = getDb()
    const alice = db.select().from(schema.person).where(eq(schema.person.displayName, 'Alice A')).get()
    expect(alice).toBeTruthy()
    const ids = db.select().from(schema.sourceIdentity).where(eq(schema.sourceIdentity.personId, alice!.id)).all()
    const sources = ids.map(i => i.source).sort()
    expect(sources).toEqual(['seerr', 'tautulli'])
  })

  it('keeps Lone Watcher as a valid single-source person', async () => {
    const { getDb, schema } = await import('../../server/db/client')
    const { eq } = await import('drizzle-orm')
    const db = getDb()
    const lone = db.select().from(schema.person).where(eq(schema.person.displayName, 'Lone Watcher')).get()
    expect(lone).toBeTruthy()
    const ids = db.select().from(schema.sourceIdentity).where(eq(schema.sourceIdentity.personId, lone!.id)).all()
    expect(ids).toHaveLength(1)
    expect(ids[0]!.source).toBe('tautulli')
  })

  it('groups the shared-email Eve/Mallory accounts into one person (email-only, ADR-0007)', async () => {
    const { getDb, schema } = await import('../../server/db/client')
    const { eq } = await import('drizzle-orm')
    const db = getDb()
    const shared = db.select().from(schema.person).where(eq(schema.person.matchKey, 'shared@x.com')).get()
    expect(shared).toBeTruthy()
    const ids = db.select().from(schema.sourceIdentity).where(eq(schema.sourceIdentity.personId, shared!.id)).all()
    expect(ids.map(i => i.source).sort()).toEqual(['seerr', 'tautulli'])
  })
})

describe('request & watch attribution', () => {
  it('attributes "requested by" to the canonical person', async () => {
    const { getDb, schema } = await import('../../server/db/client')
    const { eq } = await import('drizzle-orm')
    const db = getDb()
    const anime = db.select().from(schema.title).where(eq(schema.title.title, 'Some Anime')).get()
    const req = db.select().from(schema.request).where(eq(schema.request.titleId, anime!.id)).get()
    expect(req).toBeTruthy()
    const person = db.select().from(schema.person).where(eq(schema.person.id, req!.requestedByPersonId!)).get()
    expect(person!.displayName).toBe('Alice A')
  })

  it('attributes a series watched by two people (Alice + Lone Watcher)', async () => {
    const { getDb, schema } = await import('../../server/db/client')
    const { eq } = await import('drizzle-orm')
    const db = getDb()
    const comedy = db.select().from(schema.title).where(eq(schema.title.title, 'A Comedy')).get()
    const watchers = db.select().from(schema.titleWatcher).where(eq(schema.titleWatcher.titleId, comedy!.id)).all()
    expect(watchers.length).toBe(2)
  })
})
