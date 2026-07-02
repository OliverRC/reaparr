// Persistence + compute layer shared by the live sync (run.ts) and the demo-seed.
// Takes a bundle of NORMALIZED source data, writes the consolidated picture to
// SQLite, resolves people, and computes Reap Scores. Pure of network I/O.

import { eq, sql } from 'drizzle-orm'
import { getDb, schema } from '../db/client'
import type { IdentitySource, RawIdentity } from './identity'
import { reconcile } from '../people/register'
import { buildTitleIndex, matchTitle, type TitleRef } from './join'
import { reapScore, type ScoringConfig, type TitleFacts, DEFAULT_SCORING } from './score'
import { applyTransition } from '../reaping/stateMachine'
import { emailNotifier } from '../reaping/notifier'
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
  // Fetch-guard (docs/adr/0002): which sources were successfully fetched THIS run. A source that
  // failed or is disabled is not authoritative — the tables derived from it must NOT be wiped or
  // reconciled against an empty/partial pull (a transient failure would otherwise tombstone every
  // title, drop every request, or sever confirmed identity merges). Each flag guards its own data:
  // sonarr/radarr → title removals; seerr → requests + seerr identities; tautulli → watches +
  // tautulli identities. Missing flags default to authoritative (the demo seed / tests supply a
  // complete bundle and want a full rebuild).
  sourcesOk?: { sonarr: boolean, radarr: boolean, seerr?: boolean, tautulli?: boolean }
}

export interface PersistCounts {
  titles: number
  people: number
  requests: number
  watchEvents: number
  scored: number
  // §7 nudge: admin marked a title removed but it's still present in the *arr this run.
  discrepancies: number
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

function persistTitles(db: Db, bundle: SyncBundle, now: number): { discrepancies: number, removed: number[] } {
  // NOTE: the `values` objects below deliberately OMIT `immortalised`/`immortalisedAt`, the reaping lifecycle
  // columns (`state`/`episode`/`scheduledAt`/`dueAt`/`sendReminder`/`removedAt`) and the
  // `tautulliKey` (set later). Leaving admin-set / lifecycle columns out of the update-by-
  // (source, source_id) upsert is what preserves them across every re-sync. Do not add them here.
  const sourcesOk = bundle.sourcesOk ?? { sonarr: true, radarr: true }
  const keep = new Set<string>()

  for (const s of bundle.series) {
    keep.add(`sonarr:${s.sourceId}`)
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
    const titleId = upsertTitle(db, 'sonarr', 'series', s.sourceId, { tmdbId: s.tmdbId, tvdbId: s.tvdbId }, values)
    db.delete(schema.season).where(eq(schema.season.titleId, titleId)).run()
    for (const se of s.seasons) {
      db.insert(schema.season).values({
        titleId, seasonNumber: se.seasonNumber, sizeOnDisk: se.sizeOnDisk, episodeFiles: se.episodeFiles
      }).run()
    }
  }

  for (const m of bundle.movies) {
    keep.add(`radarr:${m.sourceId}`)
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
    upsertTitle(db, 'radarr', 'movie', m.sourceId, { tmdbId: m.tmdbId, tvdbId: null }, values)
  }

  const removed = reconcileRemovals(db, keep, sourcesOk, now)
  return { discrepancies: countDiscrepancies(db, keep), removed }
}

// Upsert one title, resurrecting a tombstone when a returned title reappears (docs/adr/0002).
// Matching: (source, source_id) first; if the same source_id was reused after a tombstone, or a
// re-added title arrives under a NEW *arr id, we reactivate the removed row (same external id) as a
// new episode. Returns the title row id.
function upsertTitle(
  db: Db,
  source: 'sonarr' | 'radarr',
  mediaType: 'series' | 'movie',
  sourceId: number,
  ext: { tmdbId: number | null, tvdbId: number | null },
  values: typeof schema.title.$inferInsert
): number {
  const bySourceId = db.select({ id: schema.title.id, state: schema.title.state }).from(schema.title)
    .where(sql`${schema.title.source} = ${source} and ${schema.title.sourceId} = ${sourceId}`).get()

  if (bySourceId) {
    db.update(schema.title).set(values).where(eq(schema.title.id, bySourceId.id)).run()
    if (bySourceId.state === 'removed') {
      // A tombstone still present under the SAME *arr id. If the admin optimistically marked it
      // removed but it never actually left the *arr, this is a discrepancy (§7) — do NOT resurrect;
      // leave it removed so the sync can nudge ("you meant to deal with this"). A sync-confirmed
      // removal that genuinely returned under the same id resurrects as a new episode.
      if (latestReason(db, bySourceId.id) !== 'admin_marked_removed') {
        applyTransition(db, bySourceId.id, {
          to: 'eligible', reason: 'resurrected', actor: { system: 'sync' },
          metadata: { resurrectedSourceId: sourceId }
        })
      }
    }
    return bySourceId.id
  }

  // No (source, source_id) match — a returning title gets a fresh *arr id. Look for a tombstone
  // with the same external id under the same source and resurrect it in place.
  const tomb = findTombstone(db, source, mediaType, ext)
  if (tomb) {
    db.update(schema.title).set(values).where(eq(schema.title.id, tomb.id)).run() // sets the new source_id
    applyTransition(db, tomb.id, {
      to: 'eligible', reason: 'resurrected', actor: { system: 'sync' },
      metadata: { previousSourceId: tomb.sourceId, newSourceId: sourceId }
    })
    return tomb.id
  }

  const r = db.insert(schema.title).values(values).run()
  return Number(r.lastInsertRowid)
}

// Reason of the most recent transition for a title (null if none).
function latestReason(db: Db, titleId: number): string | null {
  const row = db.select({ reason: schema.titleTransition.reason }).from(schema.titleTransition)
    .where(eq(schema.titleTransition.titleId, titleId))
    .orderBy(sql`${schema.titleTransition.id} desc`).get()
  return row?.reason ?? null
}

// Discrepancy (§7): a title the admin marked removed that is STILL present in an authoritative pull.
// The admin's optimistic mark hasn't been backed by an actual *arr deletion — surface a nudge count.
function countDiscrepancies(db: Db, keep: Set<string>): number {
  const removed = db.select({ id: schema.title.id, source: schema.title.source, sourceId: schema.title.sourceId })
    .from(schema.title).where(eq(schema.title.state, 'removed')).all()
  let n = 0
  for (const t of removed) {
    if (!keep.has(`${t.source}:${t.sourceId}`)) continue
    if (latestReason(db, t.id) === 'admin_marked_removed') n++
  }
  return n
}

function findTombstone(
  db: Db,
  source: 'sonarr' | 'radarr',
  mediaType: 'series' | 'movie',
  ext: { tmdbId: number | null, tvdbId: number | null }
): { id: number, sourceId: number } | undefined {
  const extId = mediaType === 'series' ? ext.tvdbId : ext.tmdbId
  if (extId == null) return undefined
  const col = mediaType === 'series' ? schema.title.tvdbId : schema.title.tmdbId
  return db.select({ id: schema.title.id, sourceId: schema.title.sourceId }).from(schema.title)
    .where(sql`${schema.title.source} = ${source} and ${schema.title.state} = 'removed' and ${col} = ${extId}`)
    .get()
}

// Tombstone (never delete) titles that are gone from an AUTHORITATIVE source this run. A source that
// failed/was disabled is skipped (fetch-guard). Already-removed titles and titles from a
// non-authoritative source are left untouched — their history survives for resurrection.
function reconcileRemovals(db: Db, keep: Set<string>, sourcesOk: { sonarr: boolean, radarr: boolean }, now: number): number[] {
  const all = db.select({
    id: schema.title.id, source: schema.title.source, sourceId: schema.title.sourceId, state: schema.title.state
  }).from(schema.title).all()
  const removed: number[] = []
  for (const t of all) {
    if (t.state === 'removed') continue
    const authoritative = sourcesOk[t.source as 'sonarr' | 'radarr']
    if (!authoritative) continue
    if (keep.has(`${t.source}:${t.sourceId}`)) continue
    applyTransition(db, t.id, { to: 'removed', reason: 'sync_confirmed_removed', actor: { system: 'sync' }, now })
    removed.push(t.id)
  }
  return removed
}

// --- People & identities ------------------------------------------------------

// Map the fetched source users into the person register (ADR-0007). Only sources fetched OK this run
// are authoritative — a failed source's identities are preserved by reconcile (fetch-guard, adr/0002),
// so raws carry only the authoritative sources' users. All person mutation lives in ../people/register.
function reconcilePeople(db: Db, bundle: SyncBundle): number {
  const seerrOk = bundle.sourcesOk?.seerr ?? true
  const tautulliOk = bundle.sourcesOk?.tautulli ?? true
  const okSources = new Set<IdentitySource>()
  if (seerrOk) okSources.add('seerr')
  if (tautulliOk) okSources.add('tautulli')

  const raws: RawIdentity[] = [
    ...(seerrOk ? bundle.seerrUsers : []).map(u => ({
      source: 'seerr' as const, sourceUserId: u.sourceUserId, username: u.username, email: u.email, friendlyName: u.friendlyName
    })),
    ...(tautulliOk ? bundle.tautulliUsers : []).map(u => ({
      source: 'tautulli' as const, sourceUserId: u.sourceUserId, username: u.username, email: u.email, friendlyName: u.friendlyName
    }))
  ]

  return reconcile(db, raws, okSources)
}

function personIdForIdentity(db: Db, source: string, sourceUserId: string): number | null {
  const row = db.select({ personId: schema.sourceIdentity.personId }).from(schema.sourceIdentity)
    .where(sql`${schema.sourceIdentity.source} = ${source} and ${schema.sourceIdentity.sourceUserId} = ${sourceUserId}`).get()
  return row?.personId ?? null
}

// --- Requests -----------------------------------------------------------------

function persistRequests(db: Db, bundle: SyncBundle, index: ReturnType<typeof buildTitleIndex>): number {
  // Fetch-guard: Seerr failed/absent this run — its requests are not authoritative. Preserve the
  // existing rows (wiping them would drop every request and blank the request-miss scoring signal
  // until the next good sync). Report the current row count.
  if (!(bundle.sourcesOk?.seerr ?? true)) {
    return db.select({ n: sql<number>`count(*)` }).from(schema.request).get()?.n ?? 0
  }
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
  // Fetch-guard: Tautulli failed/absent — history is not authoritative. Preserve existing watch
  // rows (wiping them would zero out completion/abandonment scoring until the next good sync). No
  // new events processed this run.
  if (!(bundle.sourcesOk?.tautulli ?? true)) return 0
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
    // Tombstoned titles (a closed episode) hold no live score — they are not candidates.
    if (t.state === 'removed') continue
    // watched_item rows for this title
    const items = db.select().from(schema.watchedItem).where(eq(schema.watchedItem.titleId, t.id)).all()
    const watched = items.length > 0
    const lastWatchedAt = items.reduce<string | null>((acc, it) => maxIso(acc, it.lastWatchedAt), null)

    let completion: number
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

  const { discrepancies, removed } = persistTitles(db, bundle, now)
  const peopleCount = reconcilePeople(db, bundle)

  // Build the title index AFTER titles are written.
  const titleRows = db.select({
    id: schema.title.id, mediaType: schema.title.mediaType, tmdbId: schema.title.tmdbId,
    tvdbId: schema.title.tvdbId, imdbId: schema.title.imdbId
  }).from(schema.title).all() as TitleRef[]
  const index = buildTitleIndex(titleRows)

  const reqCount = persistRequests(db, bundle, index)
  const watchCount = await persistWatches(db, bundle, index)
  const scored = scoreAllTitles(db, config, now)

  // Departed always notifies (docs/adr/0004): fire for titles the sync just confirmed removed.
  for (const id of removed) {
    const t = db.select({ id: schema.title.id, episode: schema.title.episode, title: schema.title.title, dueAt: schema.title.dueAt })
      .from(schema.title).where(eq(schema.title.id, id)).get()
    if (t) await emailNotifier.notify(db, 'departed', t, now)
  }

  return {
    titles: titleRows.length,
    people: peopleCount,
    requests: reqCount,
    watchEvents: watchCount,
    scored,
    discrepancies
  }
}

export { loadScoringConfig }
