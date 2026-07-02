import { eq } from 'drizzle-orm'
import { getDb, schema } from '../../db/client'
import { getTitleHistory } from '../../utils/reaping'

// Detail for a single title: score breakdown, local watch history (from Tautulli),
// seasons, request info, and deep links into Sonarr/Radarr/Tautulli.
export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    setResponseStatus(event, 400)
    return { error: 'Invalid id' }
  }
  const db = getDb()
  const t = db.select().from(schema.title).where(eq(schema.title.id, id)).get()
  if (!t) {
    setResponseStatus(event, 404)
    return { error: 'Not found' }
  }

  const s = db.select().from(schema.score).where(eq(schema.score.titleId, id)).get()
  const seasons = db.select().from(schema.season).where(eq(schema.season.titleId, id)).all()
    .sort((a, b) => a.seasonNumber - b.seasonNumber)

  // Local watch records (closest thing we keep to Tautulli history).
  const items = db.select().from(schema.watchedItem).where(eq(schema.watchedItem.titleId, id)).all()
    .sort((a, b) => Date.parse(b.lastWatchedAt ?? '') - Date.parse(a.lastWatchedAt ?? ''))

  const persons = db.select().from(schema.person).all()
  const personName = new Map(persons.map(p => [p.id, p.displayName]))
  const watchers = db.select().from(schema.titleWatcher).where(eq(schema.titleWatcher.titleId, id)).all()
    .map(w => ({ name: personName.get(w.personId) ?? 'Unknown', lastWatchedAt: w.lastWatchedAt }))
    .sort((a, b) => Date.parse(b.lastWatchedAt ?? '') - Date.parse(a.lastWatchedAt ?? ''))

  const req = db.select().from(schema.request).where(eq(schema.request.titleId, id)).get()
  const requestedBy = req?.requestedByPersonId != null ? personName.get(req.requestedByPersonId) ?? null : null

  // --- Deep links ---------------------------------------------------------------
  const conns = db.select().from(schema.sourceConnection).all()
  const base = (src: string) => {
    const c = conns.find(x => x.source === src)
    return c?.baseUrl ? c.baseUrl.replace(/\/+$/, '') : null
  }
  const sonarrBase = base('sonarr')
  const radarrBase = base('radarr')
  const tautulliBase = base('tautulli')

  const links = {
    sonarr: (t.mediaType === 'series' && sonarrBase && t.titleSlug) ? `${sonarrBase}/series/${t.titleSlug}` : null,
    radarr: (t.mediaType === 'movie' && radarrBase && t.tmdbId) ? `${radarrBase}/movie/${t.tmdbId}` : null,
    tautulli: (tautulliBase && t.tautulliKey) ? `${tautulliBase}/info?rating_key=${t.tautulliKey}` : null
  }

  return {
    id: t.id,
    mediaType: t.mediaType,
    title: t.title,
    year: t.year,
    spared: t.spared === 1,
    sparedAt: t.sparedAt,
    // Reaping lifecycle (functional; the frontend maps these to Death's voice).
    reaping: {
      state: t.state,
      episode: t.episode,
      scheduledAt: t.scheduledAt,
      dueAt: t.dueAt,
      sendReminder: t.sendReminder === 1,
      removedAt: t.removedAt,
      history: getTitleHistory(t.id)
    },
    seasonCount: t.seasonCount,
    sizeOnDisk: t.sizeOnDisk,
    addedAt: t.addedAt,
    seriesStatus: t.seriesStatus,
    seriesType: t.seriesType,
    downloadedEpisodes: t.downloadedEpisodes,
    externalIds: { tmdbId: t.tmdbId, tvdbId: t.tvdbId, imdbId: t.imdbId },
    // Quality ratings: `value` is the 0–10 headline (Sonarr consolidated / Radarr TMDB);
    // imdb (0–10) and rt (0–100%) are Radarr-only, so null for series.
    ratings: { value: t.rating, imdb: t.ratingImdb, rt: t.ratingRt },
    score: s
      ? {
          reapScore: s.reapScore, staleness: s.staleness, abandonment: s.abandonment,
          requestMiss: s.requestMiss, idleDays: s.idleDays, completion: s.completion,
          freshness: s.freshness, tier: s.tier, reasons: s.reasons ? JSON.parse(s.reasons) : []
        }
      : null,
    requestedBy,
    requestedAt: req?.requestedAt ?? null,
    watchers,
    watchCount: items.length,
    history: items.map(it => ({ itemKey: it.itemKey, lastWatchedAt: it.lastWatchedAt, watchedStatus: it.watchedStatus })),
    seasons: seasons.map(se => ({ seasonNumber: se.seasonNumber, sizeOnDisk: se.sizeOnDisk, episodeFiles: se.episodeFiles })),
    links,
    sourcesConfigured: { sonarr: !!sonarrBase, radarr: !!radarrBase, tautulli: !!tautulliBase }
  }
})
