import { sourceFetch } from './http'
import type { AuthInjection, ConnectionConfig, NormalizedSeries, ProbeResult, SonarrClient } from './types'

const AUTH: AuthInjection = { kind: 'header', name: 'X-Api-Key' }

interface SonarrSeasonStats { sizeOnDisk?: number, episodeFileCount?: number }
interface SonarrSeason { seasonNumber: number, statistics?: SonarrSeasonStats }
interface SonarrStats {
  seasonCount?: number
  episodeFileCount?: number
  episodeCount?: number
  totalEpisodeCount?: number
  sizeOnDisk?: number
  percentOfEpisodes?: number
}
interface SonarrSeries {
  id: number
  title: string
  year?: number
  tvdbId?: number
  imdbId?: string
  tmdbId?: number
  titleSlug?: string
  added?: string
  status?: string
  ended?: boolean
  seriesType?: string
  ratings?: { votes?: number, value?: number }
  statistics?: SonarrStats
  seasons?: SonarrSeason[]
}

function normalizeSeries(s: SonarrSeries): NormalizedSeries {
  const stats = s.statistics ?? {}
  return {
    sourceId: s.id,
    title: s.title,
    titleSlug: s.titleSlug ?? null,
    year: s.year ?? null,
    tvdbId: s.tvdbId ?? null,
    tmdbId: s.tmdbId ?? null,
    imdbId: s.imdbId ?? null,
    addedAt: s.added ?? null,
    sizeOnDisk: stats.sizeOnDisk ?? 0,
    seasonCount: stats.seasonCount ?? (s.seasons?.filter(x => x.seasonNumber > 0).length ?? 0),
    downloadedEpisodes: stats.episodeFileCount ?? 0,
    status: s.status === 'continuing' ? 'continuing' : 'ended',
    seriesType: s.seriesType ?? 'standard',
    rating: s.ratings?.value ?? null,
    seasons: (s.seasons ?? []).map(se => ({
      seasonNumber: se.seasonNumber,
      sizeOnDisk: se.statistics?.sizeOnDisk ?? 0,
      episodeFiles: se.statistics?.episodeFileCount ?? 0
    }))
  }
}

export function createSonarrClient(config: ConnectionConfig): SonarrClient {
  return {
    source: 'sonarr',
    async probe(): Promise<ProbeResult> {
      try {
        const status = await sourceFetch<{ version?: string }>(config, AUTH, '/api/v3/system/status')
        return { ok: true, message: `Sonarr ${status?.version ?? ''}`.trim() }
      } catch (err) {
        return { ok: false, message: (err as Error).message }
      }
    },
    async getSeries(): Promise<NormalizedSeries[]> {
      const series = await sourceFetch<SonarrSeries[]>(config, AUTH, '/api/v3/series')
      return (series ?? []).map(normalizeSeries)
    }
  }
}
