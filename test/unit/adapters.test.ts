import { describe, it, expect } from 'vitest'

// Adapters normalize source-shaped JSON. We exercise the normalizers by stubbing
// global fetch with representative payloads (derived from the OpenAPI/specs).

import { createSonarrClient } from '../../server/sources/sonarr'
import { createRadarrClient } from '../../server/sources/radarr'
import { createSeerrClient } from '../../server/sources/seerr'
import { createTautulliClient } from '../../server/sources/tautulli'

function stubFetch(routes: (url: string) => unknown) {
  globalThis.fetch = (async (input: string | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    const body = routes(url)
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}

const cfg = { baseUrl: 'http://mock', credential: 'k' }

describe('Sonarr adapter', () => {
  it('normalizes series with statistics + seasons', async () => {
    stubFetch(() => ([{
      id: 7, title: 'Breaking Bad', year: 2008, tvdbId: 81189, tmdbId: 1396, imdbId: 'tt0903747',
      added: '2024-01-01T00:00:00Z', status: 'ended', seriesType: 'standard',
      statistics: { seasonCount: 5, episodeFileCount: 62, sizeOnDisk: 123456789, percentOfEpisodes: 100 },
      seasons: [{ seasonNumber: 1, statistics: { sizeOnDisk: 100, episodeFileCount: 7 } }]
    }]))
    const s = await createSonarrClient(cfg).getSeries()
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({
      sourceId: 7, title: 'Breaking Bad', tvdbId: 81189, sizeOnDisk: 123456789,
      seasonCount: 5, downloadedEpisodes: 62, status: 'ended'
    })
    expect(s[0]!.seasons[0]).toMatchObject({ seasonNumber: 1, sizeOnDisk: 100, episodeFiles: 7 })
  })
})

describe('Radarr adapter', () => {
  it('normalizes movie size + hasFile', async () => {
    stubFetch(() => ([{ id: 3, title: 'Inception', year: 2010, tmdbId: 27205, imdbId: 'tt1375666', sizeOnDisk: 999, hasFile: true, added: '2024-02-02T00:00:00Z' }]))
    const m = await createRadarrClient(cfg).getMovies()
    expect(m[0]).toMatchObject({ sourceId: 3, title: 'Inception', tmdbId: 27205, sizeOnDisk: 999, hasFile: true })
  })
})

describe('Seerr adapter', () => {
  it('normalizes a single page of requests with requester identity', async () => {
    stubFetch(url => url.includes('/request')
      ? { pageInfo: { pages: 1, results: 1 }, results: [{ id: 11, status: 2, type: 'tv', createdAt: '2025-01-01T00:00:00Z', media: { tmdbId: 1396, tvdbId: 81189, mediaType: 'tv' }, requestedBy: { id: 5, email: 'a@b.com', plexUsername: 'alice', displayName: 'Alice' } }] }
      : { pageInfo: {}, results: [] })
    const r = await createSeerrClient(cfg).getRequests()
    expect(r[0]).toMatchObject({ seerrId: 11, status: 2, mediaType: 'tv', tmdbId: 1396, tvdbId: 81189 })
    expect(r[0]!.requester).toMatchObject({ sourceUserId: '5', email: 'a@b.com', username: 'alice' })
  })
})

describe('Tautulli adapter', () => {
  it('unwraps the envelope, converts epochs, and parses guids', async () => {
    stubFetch((url) => {
      if (url.includes('cmd=get_history')) {
        return { response: { result: 'success', data: { recordsFiltered: 1, data: [{ date: 1700000000, stopped: 1700000500, user_id: 9, user: 'bob', friendly_name: 'Bob', media_type: 'episode', rating_key: 555, grandparent_rating_key: 500, watched_status: 1, percent_complete: 100 }] } } }
      }
      if (url.includes('cmd=get_metadata')) {
        return { response: { result: 'success', data: { rating_key: 500, grandparent_rating_key: null, media_type: 'show', guids: ['imdb://tt0903747', 'tmdb://1396', 'tvdb://81189'] } } }
      }
      return { response: { result: 'success', data: [] } }
    })
    const t = createTautulliClient(cfg)
    const hist = await t.getHistory()
    expect(hist[0]).toMatchObject({ userId: '9', mediaType: 'episode', ratingKey: '555', grandparentRatingKey: '500', watchedStatus: 1 })
    expect(hist[0]!.lastWatchedAt).toBe(new Date(1700000500 * 1000).toISOString())
    const meta = await t.getMetadata('500')
    expect(meta).toMatchObject({ tmdbId: 1396, tvdbId: 81189, imdbId: 'tt0903747' })
  })

  it('throws on a Tautulli error envelope', async () => {
    stubFetch(() => ({ response: { result: 'error', message: 'Invalid apikey' } }))
    await expect(createTautulliClient(cfg).getUsers()).rejects.toThrow(/Invalid apikey/)
  })
})
