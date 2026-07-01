// Canonical demo dataset — one source of truth, consumed by BOTH the demo-seed
// (writes normalized data straight to SQLite) and the mock source server (re-shapes
// it into each source's real API format). Dates are day-offsets from `now`, so the
// Reap Scores are stable no matter when it runs.
//
// Designed spread (freshness=1 for all; all added > grace):
//   Series: Some Anime 100 · Dormant Unrequested 80 · A Drama 68 · Stale Series 38 · Ongoing 15 · A Comedy 0
//   Movies: Never Watched 100 · Big Unwatched 80 · Abandoned 48 · Finished 0

import type {
  NormalizedHistoryRow, NormalizedMetadata, NormalizedMovie, NormalizedRequest,
  NormalizedSeries, NormalizedSourceUser
} from '../sources/types'
import type { SyncBundle } from '../sync/persist'

const GB = 1024 * 1024 * 1024
const DAY = 86_400_000
const iso = (now: number, daysAgo: number) => new Date(now - daysAgo * DAY).toISOString()
const epoch = (now: number, daysAgo: number) => Math.floor((now - daysAgo * DAY) / 1000)

// --- People -------------------------------------------------------------------

interface Person { seerrId?: string, tautulliId?: string, email: string, username: string, friendly: string }

const ALICE: Person = { seerrId: '1', tautulliId: '11', email: 'alice@example.com', username: 'alice', friendly: 'Alice A' }
const BOB: Person = { seerrId: '2', tautulliId: '12', email: 'bob@example.com', username: 'bob', friendly: 'Bob B' }
const CAROL: Person = { seerrId: '3', tautulliId: '13', email: 'carol@example.com', username: 'carol', friendly: 'Carol C' }
const LONE: Person = { tautulliId: '14', email: 'lone@plex.tv', username: 'lonewatcher', friendly: 'Lone Watcher' }

export function buildDemoBundle(now: number = Date.now()): SyncBundle {
  // --- Sonarr series ----------------------------------------------------------
  const series: NormalizedSeries[] = [
    {
      sourceId: 1, title: 'Some Anime', titleSlug: 'some-anime', year: 2019, tvdbId: 100001, tmdbId: 200001, imdbId: 'tt9000001',
      addedAt: iso(now, 600), sizeOnDisk: 64 * GB, seasonCount: 3, downloadedEpisodes: 36,
      status: 'ended', seriesType: 'anime', rating: 8.6,
      seasons: [
        { seasonNumber: 1, sizeOnDisk: 22 * GB, episodeFiles: 12 },
        { seasonNumber: 2, sizeOnDisk: 21 * GB, episodeFiles: 12 },
        { seasonNumber: 3, sizeOnDisk: 21 * GB, episodeFiles: 12 }
      ]
    },
    {
      sourceId: 2, title: 'A Drama', titleSlug: 'a-drama', year: 2016, tvdbId: 100002, tmdbId: 200002, imdbId: 'tt9000002',
      addedAt: iso(now, 800), sizeOnDisk: 41 * GB, seasonCount: 5, downloadedEpisodes: 50,
      status: 'ended', seriesType: 'standard', rating: 8.9,
      seasons: [
        { seasonNumber: 1, sizeOnDisk: 8 * GB, episodeFiles: 10 },
        { seasonNumber: 2, sizeOnDisk: 8 * GB, episodeFiles: 10 },
        { seasonNumber: 3, sizeOnDisk: 8 * GB, episodeFiles: 10 },
        { seasonNumber: 4, sizeOnDisk: 8 * GB, episodeFiles: 10 },
        { seasonNumber: 5, sizeOnDisk: 9 * GB, episodeFiles: 10 }
      ]
    },
    {
      sourceId: 3, title: 'A Comedy', titleSlug: 'a-comedy', year: 2021, tvdbId: 100003, tmdbId: 200003, imdbId: 'tt9000003',
      addedAt: iso(now, 400), sizeOnDisk: 12 * GB, seasonCount: 2, downloadedEpisodes: 20,
      status: 'ended', seriesType: 'standard', rating: 6.2,
      seasons: [
        { seasonNumber: 1, sizeOnDisk: 6 * GB, episodeFiles: 10 },
        { seasonNumber: 2, sizeOnDisk: 6 * GB, episodeFiles: 10 }
      ]
    },
    {
      sourceId: 4, title: 'Ongoing Show', titleSlug: 'ongoing-show', year: 2024, tvdbId: 100004, tmdbId: 200004, imdbId: 'tt9000004',
      addedAt: iso(now, 200), sizeOnDisk: 30 * GB, seasonCount: 2, downloadedEpisodes: 16,
      status: 'continuing', seriesType: 'standard', rating: 7.4,
      seasons: [
        { seasonNumber: 1, sizeOnDisk: 15 * GB, episodeFiles: 8 },
        { seasonNumber: 2, sizeOnDisk: 15 * GB, episodeFiles: 8 }
      ]
    },
    {
      sourceId: 5, title: 'Stale Series', titleSlug: 'stale-series', year: 2020, tvdbId: 100005, tmdbId: 200005, imdbId: 'tt9000005',
      addedAt: iso(now, 300), sizeOnDisk: 18 * GB, seasonCount: 1, downloadedEpisodes: 10,
      status: 'ended', seriesType: 'standard', rating: 5.1,
      seasons: [{ seasonNumber: 1, sizeOnDisk: 18 * GB, episodeFiles: 10 }]
    },
    {
      sourceId: 6, title: 'Dormant Unrequested', titleSlug: 'dormant-unrequested', year: 2014, tvdbId: 100006, tmdbId: 200006, imdbId: 'tt9000006',
      addedAt: iso(now, 900), sizeOnDisk: 52 * GB, seasonCount: 4, downloadedEpisodes: 40,
      status: 'ended', seriesType: 'standard', rating: 4.3,
      seasons: [
        { seasonNumber: 1, sizeOnDisk: 13 * GB, episodeFiles: 10 },
        { seasonNumber: 2, sizeOnDisk: 13 * GB, episodeFiles: 10 },
        { seasonNumber: 3, sizeOnDisk: 13 * GB, episodeFiles: 10 },
        { seasonNumber: 4, sizeOnDisk: 13 * GB, episodeFiles: 10 }
      ]
    }
  ]

  // --- Radarr movies ----------------------------------------------------------
  const movies: NormalizedMovie[] = [
    { sourceId: 1, title: 'Never Watched Movie', year: 2022, tmdbId: 300001, imdbId: 'tt8000001', addedAt: iso(now, 500), sizeOnDisk: 8 * GB, hasFile: true, rating: 7.1, ratingImdb: 6.8, ratingRt: 74 },
    { sourceId: 2, title: 'Finished Movie', year: 2023, tmdbId: 300002, imdbId: 'tt8000002', addedAt: iso(now, 400), sizeOnDisk: 12 * GB, hasFile: true, rating: 8.2, ratingImdb: 8.0, ratingRt: 91 },
    { sourceId: 3, title: 'Abandoned Movie', year: 2021, tmdbId: 300003, imdbId: 'tt8000003', addedAt: iso(now, 450), sizeOnDisk: 15 * GB, hasFile: true, rating: 5.4, ratingImdb: 5.1, ratingRt: 42 },
    { sourceId: 4, title: 'Big Unwatched Movie', year: 2018, tmdbId: 300004, imdbId: 'tt8000004', addedAt: iso(now, 700), sizeOnDisk: 60 * GB, hasFile: true, rating: 3.9, ratingImdb: 4.2, ratingRt: 18 }
  ]

  // --- Users ------------------------------------------------------------------
  const seerrUsers: NormalizedSourceUser[] = [
    { sourceUserId: ALICE.seerrId!, email: ALICE.email, username: ALICE.username, friendlyName: 'Alice' },
    { sourceUserId: BOB.seerrId!, email: BOB.email, username: BOB.username, friendlyName: 'Bob' },
    { sourceUserId: CAROL.seerrId!, email: CAROL.email, username: CAROL.username, friendlyName: 'Carol' },
    // Eve — the conflict source: email points at Tautulli "mallory", username at Tautulli "eve".
    { sourceUserId: '9', email: 'shared@x.com', username: 'eve', friendlyName: 'Eve' }
  ]
  const tautulliUsers: NormalizedSourceUser[] = [
    { sourceUserId: ALICE.tautulliId!, email: ALICE.email, username: ALICE.username, friendlyName: ALICE.friendly },
    { sourceUserId: BOB.tautulliId!, email: BOB.email, username: BOB.username, friendlyName: BOB.friendly },
    { sourceUserId: CAROL.tautulliId!, email: CAROL.email, username: CAROL.username, friendlyName: CAROL.friendly },
    { sourceUserId: LONE.tautulliId!, email: LONE.email, username: LONE.username, friendlyName: LONE.friendly },
    { sourceUserId: '15', email: 'shared@x.com', username: 'mallory', friendlyName: 'Mallory' },
    { sourceUserId: '16', email: 'eve@other.com', username: 'eve', friendlyName: 'Eve T' }
  ]

  // --- Requests ---------------------------------------------------------------
  const req = (seerrId: number, mediaType: 'movie' | 'tv', ids: { tmdbId?: number, tvdbId?: number }, p: Person, daysAgo: number): NormalizedRequest => ({
    seerrId, status: 2, requestedAt: iso(now, daysAgo), mediaType,
    tmdbId: ids.tmdbId ?? null, tvdbId: ids.tvdbId ?? null,
    requester: { sourceUserId: p.seerrId!, email: p.email, username: p.username, friendlyName: p.friendly }
  })
  const requests: NormalizedRequest[] = [
    req(1, 'tv', { tvdbId: 100001, tmdbId: 200001 }, ALICE, 600), // Some Anime
    req(2, 'tv', { tvdbId: 100002, tmdbId: 200002 }, BOB, 800), // A Drama
    req(3, 'tv', { tvdbId: 100003 }, ALICE, 400), // A Comedy
    req(5, 'tv', { tvdbId: 100005 }, CAROL, 300), // Stale Series
    req(10, 'movie', { tmdbId: 300001 }, BOB, 500), // Never Watched Movie
    req(11, 'movie', { tmdbId: 300002 }, CAROL, 400), // Finished Movie
    req(12, 'movie', { tmdbId: 300003 }, ALICE, 450) // Abandoned Movie
  ]

  // --- Watch history ----------------------------------------------------------
  const history: NormalizedHistoryRow[] = []
  const episodes = (gp: string, base: number, count: number, p: Person, daysAgo: number) => {
    for (let i = 0; i < count; i++) {
      history.push({
        lastWatchedAt: iso(now, daysAgo), userId: p.tautulliId!, username: p.username, friendlyName: p.friendly,
        mediaType: 'episode', ratingKey: String(base + i), grandparentRatingKey: gp,
        watchedStatus: 1, percentComplete: 100
      })
    }
  }
  episodes('5002', 520001, 20, CAROL, 420) // A Drama: 20/50 → 0.4
  episodes('5003', 530001, 20, ALICE, 21) // A Comedy: 20/20 → 1.0
  episodes('5003', 530001, 2, LONE, 25) // Lone Watcher also watched 2 episodes → second watcher
  episodes('5004', 540001, 8, BOB, 30) // Ongoing Show: 8/16 → 0.5
  episodes('5005', 550001, 3, CAROL, 150) // Stale Series: 3/10 → 0.3
  // Movies
  history.push({
    lastWatchedAt: iso(now, 60), userId: CAROL.tautulliId!, username: CAROL.username, friendlyName: CAROL.friendly,
    mediaType: 'movie', ratingKey: '6002', grandparentRatingKey: null, watchedStatus: 1, percentComplete: 100
  })
  history.push({
    lastWatchedAt: iso(now, 300), userId: ALICE.tautulliId!, username: ALICE.username, friendlyName: ALICE.friendly,
    mediaType: 'movie', ratingKey: '6003', grandparentRatingKey: null, watchedStatus: 0.5, percentComplete: 48
  })

  // --- Metadata (rating_key / grandparent_rating_key → external IDs) ----------
  const metadata: Record<string, NormalizedMetadata> = {
    5002: { ratingKey: '5002', grandparentRatingKey: null, mediaType: 'show', tmdbId: 200002, tvdbId: 100002, imdbId: 'tt9000002' },
    5003: { ratingKey: '5003', grandparentRatingKey: null, mediaType: 'show', tmdbId: 200003, tvdbId: 100003, imdbId: 'tt9000003' },
    5004: { ratingKey: '5004', grandparentRatingKey: null, mediaType: 'show', tmdbId: 200004, tvdbId: 100004, imdbId: 'tt9000004' },
    5005: { ratingKey: '5005', grandparentRatingKey: null, mediaType: 'show', tmdbId: 200005, tvdbId: 100005, imdbId: 'tt9000005' },
    6002: { ratingKey: '6002', grandparentRatingKey: null, mediaType: 'movie', tmdbId: 300002, tvdbId: null, imdbId: 'tt8000002' },
    6003: { ratingKey: '6003', grandparentRatingKey: null, mediaType: 'movie', tmdbId: 300003, tvdbId: null, imdbId: 'tt8000003' }
  }

  return {
    series,
    movies,
    seerrUsers,
    tautulliUsers,
    requests,
    history,
    resolveMetadata: async (key: string) => metadata[key] ?? null
  }
}

// Raw dataset accessor for the mock server (it needs day-offsets + epochs to reshape).
export function buildDemoRaw(now: number = Date.now()) {
  return { bundle: buildDemoBundle(now), iso: (d: number) => iso(now, d), epoch: (d: number) => epoch(now, d) }
}
