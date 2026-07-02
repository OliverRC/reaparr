// Source adapter contracts (plan §4). Every adapter returns NORMALIZED typed
// objects — the rest of the pipeline never sees source-shaped JSON.

export type Source = 'sonarr' | 'radarr' | 'seerr' | 'tautulli'

export type AuthInjection
  = | { kind: 'header', name: string } // sonarr, radarr, seerr → X-Api-Key
    | { kind: 'query', param: string } // tautulli → ?apikey=

export interface ProbeResult { ok: boolean, message: string }

export interface ConnectionConfig {
  baseUrl: string
  credential: string
}

// --- Normalized payloads ------------------------------------------------------

export interface NormalizedSeason {
  seasonNumber: number
  sizeOnDisk: number
  episodeFiles: number
}

export interface NormalizedSeries {
  sourceId: number
  title: string
  titleSlug: string | null
  year: number | null
  tvdbId: number | null
  tmdbId: number | null
  imdbId: string | null
  addedAt: string | null
  sizeOnDisk: number
  seasonCount: number
  downloadedEpisodes: number
  status: string | null // 'continuing'|'ended' (normalized)
  seriesType: string | null // 'standard'|'anime'
  rating: number | null // consolidated 0–10 community score
  seasons: NormalizedSeason[]
}

export interface NormalizedMovie {
  sourceId: number
  title: string
  year: number | null
  tmdbId: number | null
  imdbId: string | null
  addedAt: string | null
  sizeOnDisk: number
  hasFile: boolean
  rating: number | null // TMDB 0–10
  ratingImdb: number | null // IMDB 0–10
  ratingRt: number | null // Rotten Tomatoes critic score 0–100
}

export interface NormalizedRequest {
  seerrId: number
  status: number // Seerr status code
  requestedAt: string | null
  mediaType: 'movie' | 'tv'
  tmdbId: number | null
  tvdbId: number | null
  requester: NormalizedSourceUser | null
}

export interface NormalizedSourceUser {
  sourceUserId: string
  email: string | null
  username: string | null // Plex username (match key)
  friendlyName: string | null // display only
}

export interface NormalizedHistoryRow {
  lastWatchedAt: string | null
  userId: string
  username: string | null
  friendlyName: string | null
  mediaType: 'movie' | 'episode'
  ratingKey: string
  grandparentRatingKey: string | null
  watchedStatus: number // 0|0.5|1
  percentComplete: number
}

export interface NormalizedMetadata {
  ratingKey: string
  grandparentRatingKey: string | null
  mediaType: string | null
  tmdbId: number | null
  tvdbId: number | null
  imdbId: string | null
}

export interface SourceClient {
  source: Source
  probe(): Promise<ProbeResult>
}

export interface SonarrClient extends SourceClient {
  getSeries(): Promise<NormalizedSeries[]>
}
export interface RadarrClient extends SourceClient {
  getMovies(): Promise<NormalizedMovie[]>
}
export interface SeerrClient extends SourceClient {
  getRequests(): Promise<NormalizedRequest[]>
  getUsers(): Promise<NormalizedSourceUser[]>
}
export interface TautulliClient extends SourceClient {
  getHistory(after?: string): Promise<NormalizedHistoryRow[]>
  getUsers(): Promise<NormalizedSourceUser[]>
  getMetadata(ratingKey: string): Promise<NormalizedMetadata | null>
}
