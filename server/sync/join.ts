// Title join — pure, deterministic matching on external metadata IDs (spec §6.4).
// No fuzzy title matching: tmdbId (movies) / tvdbId|tmdbId (series) are canonical.

export interface TitleRef {
  id: number
  mediaType: 'series' | 'movie'
  tmdbId?: number | null
  tvdbId?: number | null
  imdbId?: string | null
}

export interface ExternalIds {
  mediaType?: 'series' | 'movie' | null
  tmdbId?: number | null
  tvdbId?: number | null
  imdbId?: string | null
}

export interface TitleIndex {
  byTmdb: Map<number, number>
  byTvdb: Map<number, number>
  byImdb: Map<string, number>
}

const normImdb = (s?: string | null): string | null =>
  s ? s.trim().toLowerCase() : null

export function buildTitleIndex(titles: TitleRef[]): TitleIndex {
  const byTmdb = new Map<number, number>()
  const byTvdb = new Map<number, number>()
  const byImdb = new Map<string, number>()
  for (const t of titles) {
    if (t.tmdbId != null && !byTmdb.has(t.tmdbId)) byTmdb.set(t.tmdbId, t.id)
    if (t.tvdbId != null && !byTvdb.has(t.tvdbId)) byTvdb.set(t.tvdbId, t.id)
    const im = normImdb(t.imdbId)
    if (im && !byImdb.has(im)) byImdb.set(im, t.id)
  }
  return { byTmdb, byTvdb, byImdb }
}

/**
 * Resolve external IDs to a local title id. Priority: tvdb (series) / tmdb → tmdb → imdb.
 * Series prefer tvdb first (Sonarr's strongest key); movies prefer tmdb.
 * Returns the title id or null if no ID matches.
 */
export function matchTitle(ids: ExternalIds, index: TitleIndex): number | null {
  const isSeries = ids.mediaType === 'series'
  const tryTvdb = () => (ids.tvdbId != null ? index.byTvdb.get(ids.tvdbId) ?? null : null)
  const tryTmdb = () => (ids.tmdbId != null ? index.byTmdb.get(ids.tmdbId) ?? null : null)
  const tryImdb = () => {
    const im = normImdb(ids.imdbId)
    return im ? index.byImdb.get(im) ?? null : null
  }

  const order = isSeries ? [tryTvdb, tryTmdb, tryImdb] : [tryTmdb, tryImdb, tryTvdb]
  for (const fn of order) {
    const hit = fn()
    if (hit != null) return hit
  }
  return null
}
