import { sourceFetch } from './http'
import type { AuthInjection, ConnectionConfig, NormalizedMovie, ProbeResult, RadarrClient } from './types'

const AUTH: AuthInjection = { kind: 'header', name: 'X-Api-Key' }

// Each rating child is { votes, value, type }. imdb/tmdb are 0–10; rottenTomatoes
// is the critic score as a percentage (0–100).
interface RadarrRatingChild { votes?: number, value?: number, type?: string }

interface RadarrMovie {
  id: number
  title: string
  year?: number
  tmdbId?: number
  imdbId?: string
  sizeOnDisk?: number
  hasFile?: boolean
  added?: string
  ratings?: { imdb?: RadarrRatingChild, tmdb?: RadarrRatingChild, rottenTomatoes?: RadarrRatingChild }
  statistics?: { sizeOnDisk?: number }
}

function normalizeMovie(m: RadarrMovie): NormalizedMovie {
  return {
    sourceId: m.id,
    title: m.title,
    year: m.year ?? null,
    tmdbId: m.tmdbId ?? null,
    imdbId: m.imdbId ?? null,
    addedAt: m.added ?? null,
    sizeOnDisk: m.sizeOnDisk ?? m.statistics?.sizeOnDisk ?? 0,
    hasFile: m.hasFile ?? false,
    rating: m.ratings?.tmdb?.value ?? null,
    ratingImdb: m.ratings?.imdb?.value ?? null,
    ratingRt: m.ratings?.rottenTomatoes?.value ?? null
  }
}

export function createRadarrClient(config: ConnectionConfig): RadarrClient {
  return {
    source: 'radarr',
    async probe(): Promise<ProbeResult> {
      try {
        const status = await sourceFetch<{ version?: string }>(config, AUTH, '/api/v3/system/status')
        return { ok: true, message: `Radarr ${status?.version ?? ''}`.trim() }
      } catch (err) {
        return { ok: false, message: (err as Error).message }
      }
    },
    async getMovies(): Promise<NormalizedMovie[]> {
      const movies = await sourceFetch<RadarrMovie[]>(config, AUTH, '/api/v3/movie')
      return (movies ?? []).map(normalizeMovie)
    }
  }
}
