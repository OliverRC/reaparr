// Persistence + compute layer shared by the live sync (run.ts) and the demo-seed.
// Takes a bundle of NORMALIZED source data, writes the consolidated picture to
// SQLite, resolves people, and computes Reap Scores. Pure of network I/O.

import { eq, sql } from 'drizzle-orm'
import { getDb, schema } from '../db/client'
import { resolveIdentities, type RawIdentity } from './identity'
import { buildTitleIndex, matchTitle, type TitleRef } from './join'
import { reapScore, type ScoringConfig, type TitleFacts, DEFAULT_SCORING } from './score'
import type {
  NormalizedHistoryRow, NormalizedMetadata, NormalizedMovie, NormalizedRequest,
  NormalizedSeries, NormalizedSourceUser
} from '../sources/types'

export interface SyncBundle {
  series: NormalizedSeries[]
  movies: NormalizedMovie[]
  seerrUsers: NormalizedSourceUser[]
  tautulliUsers: NormalizedSourceUser[]
  requests: NormalizedRequest[]
  history: NormalizedHistoryRow[]
  // resolve a rating_key (movie) or grandparent_rating_key (episode) → external IDs
  resolveMetadata: (ratingKey: string) => Promise<NormalizedMetadata | null>
}

export interface PersistCounts {
  titles: number
  people: number
  requests: number
  watchEvents: number
  scored: number
  needsReview: number
}

type Db = ReturnType<typeof getDb>

function loadScoringConfig(db: Db): ScoringConfig {
  const rows = db.select().from(schema.appSetting).all()
  const map = new Map(rows.map(r => [r.key, r.value]))
  const num = (k: string, d: number) => {
    const v = map.get(k)
    const n = v != null ? Number(v) : NaN
    return Number.isFinite(n) ? n : d
  }
  return {
    graceDays: num('grace_days', DEFAULT_SCORING.graceDays),
    staleT1: num('stale_t1', DEFAULT_SCORING.staleT1),
    staleT2: num('stale_t2', DEFAULT_SCORING.staleT2),
    staleT3: num('stale_t3', DEFAULT_SCORING.staleT3)
  }
}

// --- Titles -------------------------------------------------------------------

function persistTitles(db: Db, bundle: SyncBundle): void {
  // NOTE: the `values` objects below deliberately OMIT `spared`/`sparedAt` (and the
  // `tautulliKey`, set later). Leaving admin-set columns out of the update-by-
  // (source, source_id) upsert is what preserves them across every re-sync. Do not
  // add them here.
  const keep = new Set<string>()

  for (const s of bundle.series) {
    keep.add(`sonarr:${s.sourceId}`)
    const existing = db.select({ id: schema.title.id }).from(schema.title)
      .where(sql`${schema.title.source} = 'sonarr' and ${schema.title.sourceId} = ${s.sourceId}`).get()
    const values = {
      mediaType: 'series' as const,
      source: 'sonarr',
      sourceId: s.sourceId,
      tmdbId: s.tmdbId,
      tvdbId: s.tvdbId,
      imdbId: s.imdbId,
      title: s.title,
      titleSlug: s.titleSlug,
      year: s.year,
      addedAt: s.addedAt,
      sizeOnDisk: s.sizeOnDisk,
      seasonCount: s.seasonCount,
      downloadedEpisodes: s.downloadedEpisodes,
      seriesStatus: s.status,
      seriesType: s.seriesType,
      rating: s.rating,
      ratingImdb: null,
      ratingRt: null
    }
    let titleId: number
    if (existing) {
      db.update(schema.title).set(values).where(eq(schema.title.id, existing.id)).run()
      titleId = existing.id
    } else {
      const r = db.insert(schema.title).values(values).run()
      titleId = Number(r.lastInsertRowid)
    }
    db.delete(schema.season).where(eq(schema.season.titleId, titleId)).run()
    for (const se of s.seasons) {
      db.insert(schema.season).values({
        titleId, seasonNumber: se.seasonNumber, sizeOnDisk: se.sizeOnDisk, episodeFiles: se.episodeFiles
      }).run()
    }
  }

  for (const m of bundle.movies) {
    keep.add(`radarr:${m.sourceId}`)
    const existing = db.select({ id: schema.title.id }).from(schema.title)
      .where(sql`${schema.title.source} = 'radarr' and ${schema.title.sourceId} = ${m.sourceId}`).get()
    const values = {
      mediaType: 'movie' as const,
      source: 'radarr',
      sourceId: m.sourceId,
      tmdbId: m.tmdbId,
      tvdbId: null,
      imdbId: m.imdbId,
      title: m.title,
      year: m.year,
      addedAt: m.addedAt,
      sizeOnDisk: m.sizeOnDisk,
      seasonCount: null,
      downloadedEpisodes: null,
      seriesStatus: null,
      seriesType: null,
      rating: m.rating,
      ratingImdb: m.ratingImdb,
      ratingRt: m.ratingRt
    }
    if (existing) {
      db.update(schema.title).set(values).where(eq(schema.title.id, existing.id)).run()
    } else {
      db.insert(schema.title).values(values).run()
    }
  }

  // Drop titles no longer present in either *arr (a removed file).
  const all = db.select({ id: schema.title.id, source: schema.title.source, sourceId: schema.title.sourceId })
    .from(schema.title).all()
  for (const t of all) {
    if (!keep.has(`${t.source}:${t.sourceId}`)) {
      db.delete(schema.title).where(eq(schema.title.id, t.id)).run()
    }
  }
}

// --- People & identities ------------------------------------------------------

function persistPeople(db: Db, bundle: SyncBundle): number {
  const raws: RawIdentity[] = [
    ...bundle.seerrUsers.map(u => ({
      source: 'seerr' as const, sourceUserId: u.sourceUserId, username: u.username, email: u.email, friendlyName: u.friendlyName
    })),
    ...bundle.tautulliUsers.map(u => ({
      source: 'tautulli' as const, sourceUserId: u.sourceUserId, username: u.username, email: u.email, friendlyName: u.friendlyName
    }))
  ]

  // Snapshot existing identity→person + confirmed persons BEFORE rewrite.
  const existingIdentities = db.select().from(schema.sourceIdentity).all()
  const existingPersons = db.select().from(schema.person).all()
  const confirmedPersonIds = new Set(existingPersons.filter(p => p.matchStatus === 'confirmed').map(p => p.id))
  const memberPersonIds = new Set(existingPersons.filter(p => p.isMember === 1).map(p => p.id))
  const hiddenPersonIds = new Set(existingPersons.filter(p => p.isHidden === 1).map(p => p.id))
  const identityToPerson = new Map<string, number>() // 'source:userId' → personId
  // Identity keys that belonged to a member / hidden person — the flag follows the identity across re-matching.
  const memberIdentityKeys = new Set<string>()
  const hiddenIdentityKeys = new Set<string>()
  for (const i of existingIdentities) {
    if (i.personId != null) {
      identityToPerson.set(`${i.source}:${i.sourceUserId}`, i.personId)
      const key = `${i.source}:${i.sourceUserId}`
      if (memberPersonIds.has(i.personId)) memberIdentityKeys.add(key)
      if (hiddenPersonIds.has(i.personId)) hiddenIdentityKeys.add(key)
    }
  }

  const groups = resolveIdentities(raws)

  // Wipe and rebuild identities; persons preserved/created below.
  db.delete(schema.sourceIdentity).run()

  const usedPersonIds = new Set<number>()

  for (const g of groups) {
    const memberKeys = g.identities.map(i => `${i.source}:${i.sourceUserId}`)
    // Which confirmed persons do these identities currently belong to?
    const confirmedHits = [...new Set(memberKeys.map(k => identityToPerson.get(k)).filter((p): p is number => p != null && confirmedPersonIds.has(p)))]

    if (confirmedHits.length === 1) {
      // Single confirmed person owns (some of) this group → attach all to it (a manual merge survives).
      const pid = confirmedHits[0]!
      usedPersonIds.add(pid)
      for (const i of g.identities) {
        db.insert(schema.sourceIdentity).values({
          personId: pid, source: i.source, sourceUserId: i.sourceUserId, username: i.username, email: i.email, friendlyName: i.friendlyName
        }).run()
      }
    } else if (confirmedHits.length > 1) {
      // A manual split — keep each identity with its existing confirmed person; others get a fresh person.
      const freshByStatus = createPerson(db, g.displayName, g.matchStatus)
      usedPersonIds.add(freshByStatus)
      for (const i of g.identities) {
        const existing = identityToPerson.get(`${i.source}:${i.sourceUserId}`)
        const pid = (existing != null && confirmedPersonIds.has(existing)) ? existing : freshByStatus
        usedPersonIds.add(pid)
        db.insert(schema.sourceIdentity).values({
          personId: pid, source: i.source, sourceUserId: i.sourceUserId, username: i.username, email: i.email, friendlyName: i.friendlyName
        }).run()
      }
    } else {
      const pid = createPerson(db, g.displayName, g.matchStatus)
      usedPersonIds.add(pid)
      for (const i of g.identities) {
        db.insert(schema.sourceIdentity).values({
          personId: pid, source: i.source, sourceUserId: i.sourceUserId, username: i.username, email: i.email, friendlyName: i.friendlyName
        }).run()
      }
    }
  }

  // Remove orphan persons (no identities now).
  for (const p of existingPersons) {
    if (!usedPersonIds.has(p.id)) {
      db.delete(schema.person).where(eq(schema.person.id, p.id)).run()
    }
  }

  // Re-apply member/hidden flags: any person now owning a formerly-flagged identity keeps the flag.
  if (memberIdentityKeys.size > 0 || hiddenIdentityKeys.size > 0) {
    const rebuilt = db.select().from(schema.sourceIdentity).all()
    const stillMembers = new Set<number>()
    const stillHidden = new Set<number>()
    for (const i of rebuilt) {
      if (i.personId == null) continue
      const key = `${i.source}:${i.sourceUserId}`
      if (memberIdentityKeys.has(key)) stillMembers.add(i.personId)
      if (hiddenIdentityKeys.has(key)) stillHidden.add(i.personId)
    }
    for (const pid of stillMembers) {
      db.update(schema.person).set({ isMember: 1 }).where(eq(schema.person.id, pid)).run()
    }
    for (const pid of stillHidden) {
      db.update(schema.person).set({ isHidden: 1 }).where(eq(schema.person.id, pid)).run()
    }
  }

  return db.select({ n: sql<number>`count(*)` }).from(schema.person).get()?.n ?? 0
}

function createPerson(db: Db, displayName: string, matchStatus: string): number {
  const r = db.insert(schema.person).values({ displayName, matchStatus }).run()
  return Number(r.lastInsertRowid)
}

function personIdForIdentity(db: Db, source: string, sourceUserId: string): number | null {
  const row = db.select({ personId: schema.sourceIdentity.personId }).from(schema.sourceIdentity)
    .where(sql`${schema.sourceIdentity.source} = ${source} and ${schema.sourceIdentity.sourceUserId} = ${sourceUserId}`).get()
  return row?.personId ?? null
}

// --- Requests -----------------------------------------------------------------

function persistRequests(db: Db, bundle: SyncBundle, index: ReturnType<typeof buildTitleIndex>): number {
  db.delete(schema.request).run()
  let n = 0
  for (const r of bundle.requests) {
    const titleId = matchTitle(
      { mediaType: r.mediaType === 'tv' ? 'series' : 'movie', tmdbId: r.tmdbId, tvdbId: r.tvdbId },
      index
    )
    const personId = r.requester ? personIdForIdentity(db, 'seerr', r.requester.sourceUserId) : null
    db.insert(schema.request).values({
      seerrId: r.seerrId,
      titleId,
      tmdbId: r.tmdbId,
      tvdbId: r.tvdbId,
      mediaType: r.mediaType,
      status: r.status,
      requestedAt: r.requestedAt,
      requestedByPersonId: personId
    }).run()
    n++
  }
  return n
}

// --- Watches ------------------------------------------------------------------

async function persistWatches(db: Db, bundle: SyncBundle, index: ReturnType<typeof buildTitleIndex>): Promise<number> {
  db.delete(schema.watchedItem).run()
  db.delete(schema.titleWatcher).run()

  const metaCache = new Map<string, NormalizedMetadata | null>()
  const resolve = async (key: string): Promise<NormalizedMetadata | null> => {
    if (metaCache.has(key)) return metaCache.get(key)!
    // Check DB cache first.
    const cached = db.select().from(schema.metadataCache).where(eq(schema.metadataCache.ratingKey, key)).get()
    if (cached) {
      const m: NormalizedMetadata = {
        ratingKey: cached.ratingKey, grandparentRatingKey: cached.grandparentRatingKey,
        mediaType: cached.mediaType, tmdbId: cached.tmdbId, tvdbId: cached.tvdbId, imdbId: cached.imdbId
      }
      metaCache.set(key, m)
      return m
    }
    const m = await bundle.resolveMetadata(key)
    metaCache.set(key, m)
    if (m) {
      db.insert(schema.metadataCache).values({
        ratingKey: key, grandparentRatingKey: m.grandparentRatingKey, mediaType: m.mediaType,
        tmdbId: m.tmdbId, tvdbId: m.tvdbId, imdbId: m.imdbId, resolvedAt: new Date().toISOString()
      }).onConflictDoNothing().run()
    }
    return m
  }

  const keyedTitles = new Set<number>()
  let events = 0
  for (const row of bundle.history) {
    // For an episode, the title key is the grandparent (the show); for a movie, the rating_key.
    const lookupKey = row.mediaType === 'episode' ? (row.grandparentRatingKey ?? row.ratingKey) : row.ratingKey
    const meta = await resolve(lookupKey)
    if (!meta) continue
    const titleId = matchTitle(
      { mediaType: row.mediaType === 'episode' ? 'series' : 'movie', tmdbId: meta.tmdbId, tvdbId: meta.tvdbId, imdbId: meta.imdbId },
      index
    )
    if (titleId == null) continue
    events++

    // Record the Tautulli deep-link key (show grandparent / movie rating_key) once per title.
    if (!keyedTitles.has(titleId)) {
      db.update(schema.title).set({ tautulliKey: lookupKey }).where(eq(schema.title.id, titleId)).run()
      keyedTitles.add(titleId)
    }

    const itemKey = row.ratingKey
    const watchedAt = row.lastWatchedAt

    // watched_item: distinct episode/movie consumed (max status + latest watch).
    const existingItem = db.select().from(schema.watchedItem)
      .where(sql`${schema.watchedItem.titleId} = ${titleId} and ${schema.watchedItem.itemKey} = ${itemKey}`).get()
    const newStatus = Math.max(existingItem?.watchedStatus ?? 0, row.watchedStatus)
    const newLast = maxIso(existingItem?.lastWatchedAt ?? null, watchedAt)
    if (existingItem) {
      db.update(schema.watchedItem).set({ watchedStatus: newStatus, lastWatchedAt: newLast })
        .where(sql`${schema.watchedItem.titleId} = ${titleId} and ${schema.watchedItem.itemKey} = ${itemKey}`).run()
    } else {
      db.insert(schema.watchedItem).values({ titleId, itemKey, watchedStatus: newStatus, lastWatchedAt: newLast }).run()
    }

    // title_watcher: per-person attribution.
    const personId = personIdForIdentity(db, 'tautulli', row.userId)
    if (personId != null) {
      const existingW = db.select().from(schema.titleWatcher)
        .where(sql`${schema.titleWatcher.titleId} = ${titleId} and ${schema.titleWatcher.personId} = ${personId}`).get()
      const last = maxIso(existingW?.lastWatchedAt ?? null, watchedAt)
      if (existingW) {
        db.update(schema.titleWatcher).set({ lastWatchedAt: last })
          .where(sql`${schema.titleWatcher.titleId} = ${titleId} and ${schema.titleWatcher.personId} = ${personId}`).run()
      } else {
        db.insert(schema.titleWatcher).values({ titleId, personId, lastWatchedAt: last }).run()
      }
    }
  }
  return events
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return Date.parse(a) >= Date.parse(b) ? a : b
}

// --- Scoring ------------------------------------------------------------------

function scoreAllTitles(db: Db, config: ScoringConfig, now: number): number {
  db.delete(schema.score).run()
  const titles = db.select().from(schema.title).all()
  let n = 0
  for (const t of titles) {
    // watched_item rows for this title
    const items = db.select().from(schema.watchedItem).where(eq(schema.watchedItem.titleId, t.id)).all()
    const watched = items.length > 0
    const lastWatchedAt = items.reduce<string | null>((acc, it) => maxIso(acc, it.lastWatchedAt), null)

    let completion = 0
    if (t.mediaType === 'movie') {
      completion = items.reduce((acc, it) => Math.max(acc, it.watchedStatus ?? 0), 0)
    } else {
      const distinctFullyWatched = items.filter(it => (it.watchedStatus ?? 0) >= 1).length
      const denom = t.downloadedEpisodes && t.downloadedEpisodes > 0 ? t.downloadedEpisodes : (items.length || 1)
      completion = denom > 0 ? Math.min(1, distinctFullyWatched / denom) : 0
    }

    // requested?
    const req = db.select({ id: schema.request.id, personId: schema.request.requestedByPersonId })
      .from(schema.request).where(eq(schema.request.titleId, t.id)).get()
    const requested = !!req
    let requestedByName: string | null = null
    if (req?.personId != null) {
      requestedByName = db.select({ n: schema.person.displayName }).from(schema.person)
        .where(eq(schema.person.id, req.personId)).get()?.n ?? null
    }

    const facts: TitleFacts = {
      mediaType: t.mediaType as 'series' | 'movie',
      title: t.title,
      addedAt: t.addedAt,
      watched,
      lastWatchedAt,
      completion,
      requested,
      requestedByName,
      seriesAiring: t.seriesStatus === 'continuing'
    }
    const result = reapScore(facts, config, now)
    db.insert(schema.score).values({
      titleId: t.id,
      reapScore: result.reap,
      staleness: result.S,
      abandonment: result.A,
      requestMiss: result.R,
      idleDays: result.idleDays,
      completion: result.completion,
      freshness: result.freshness,
      tier: result.tier,
      reasons: JSON.stringify(result.reasons),
      computedAt: new Date(now).toISOString()
    }).run()
    n++
  }
  return n
}

// --- Orchestration ------------------------------------------------------------

export async function persistBundle(bundle: SyncBundle, now: number = Date.now()): Promise<PersistCounts> {
  const db = getDb()
  const config = loadScoringConfig(db)

  persistTitles(db, bundle)
  const peopleCount = persistPeople(db, bundle)

  // Build the title index AFTER titles are written.
  const titleRows = db.select({
    id: schema.title.id, mediaType: schema.title.mediaType, tmdbId: schema.title.tmdbId,
    tvdbId: schema.title.tvdbId, imdbId: schema.title.imdbId
  }).from(schema.title).all() as TitleRef[]
  const index = buildTitleIndex(titleRows)

  const reqCount = persistRequests(db, bundle, index)
  const watchCount = await persistWatches(db, bundle, index)
  const scored = scoreAllTitles(db, config, now)

  const needsReview = db.select({ n: sql<number>`count(*)` }).from(schema.person)
    .where(eq(schema.person.matchStatus, 'needs_review')).get()?.n ?? 0

  return {
    titles: titleRows.length,
    people: peopleCount,
    requests: reqCount,
    watchEvents: watchCount,
    scored,
    needsReview
  }
}

export { loadScoringConfig }
