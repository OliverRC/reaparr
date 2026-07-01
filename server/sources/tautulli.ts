import { sourceFetch } from './http'
import type {
  AuthInjection, ConnectionConfig, NormalizedHistoryRow, NormalizedMetadata,
  NormalizedSourceUser, ProbeResult, TautulliClient
} from './types'

// Tautulli auth rides in the query string: ?apikey=<key>&cmd=<command>
const AUTH: AuthInjection = { kind: 'query', param: 'apikey' }
const PAGE = 100

interface TautulliEnvelope<T> { response?: { result?: string, message?: string, data?: T } }

interface TautulliHistoryRow {
  date?: number
  stopped?: number
  user_id?: number
  user?: string
  friendly_name?: string
  media_type?: string
  rating_key?: number | string
  grandparent_rating_key?: number | string
  watched_status?: number
  percent_complete?: number
}
interface TautulliHistoryData { recordsFiltered?: number, data?: TautulliHistoryRow[] }

interface TautulliUser {
  user_id?: number
  username?: string
  friendly_name?: string
  email?: string
}

interface TautulliMetadata {
  rating_key?: number | string
  grandparent_rating_key?: number | string
  media_type?: string
  guids?: string[]
}

const epochToIso = (n?: number): string | null =>
  (typeof n === 'number' && n > 0) ? new Date(n * 1000).toISOString() : null

function parseGuids(guids?: string[]): { tmdbId: number | null, tvdbId: number | null, imdbId: string | null } {
  let tmdbId: number | null = null
  let tvdbId: number | null = null
  let imdbId: string | null = null
  for (const g of guids ?? []) {
    const m = /^(imdb|tmdb|tvdb):\/\/(.+)$/i.exec(g.trim())
    if (!m) continue
    const kind = m[1]!.toLowerCase()
    const val = m[2]!
    if (kind === 'imdb') imdbId = val
    else if (kind === 'tmdb') tmdbId = Number.parseInt(val, 10) || null
    else if (kind === 'tvdb') tvdbId = Number.parseInt(val, 10) || null
  }
  return { tmdbId, tvdbId, imdbId }
}

async function call<T>(config: ConnectionConfig, cmd: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const env = await sourceFetch<TautulliEnvelope<T>>(config, AUTH, '/api/v2', { query: { cmd, ...params } })
  if (env?.response?.result !== 'success') {
    throw new Error(env?.response?.message || `Tautulli ${cmd} failed`)
  }
  return env.response.data as T
}

function normalizeRow(r: TautulliHistoryRow): NormalizedHistoryRow {
  return {
    lastWatchedAt: epochToIso(r.stopped) ?? epochToIso(r.date),
    userId: String(r.user_id ?? ''),
    username: r.user ?? null,
    friendlyName: r.friendly_name ?? null,
    mediaType: r.media_type === 'episode' ? 'episode' : 'movie',
    ratingKey: String(r.rating_key ?? ''),
    grandparentRatingKey: r.grandparent_rating_key != null ? String(r.grandparent_rating_key) : null,
    watchedStatus: typeof r.watched_status === 'number' ? r.watched_status : 0,
    percentComplete: r.percent_complete ?? 0
  }
}

export function createTautulliClient(config: ConnectionConfig): TautulliClient {
  return {
    source: 'tautulli',
    async probe(): Promise<ProbeResult> {
      try {
        const info = await call<{ pms_name?: string, pms_version?: string }>(config, 'get_server_info')
        return { ok: true, message: `Tautulli → ${info?.pms_name ?? 'Plex'} ${info?.pms_version ?? ''}`.trim() }
      } catch (err) {
        return { ok: false, message: (err as Error).message }
      }
    },
    async getHistory(after?: string): Promise<NormalizedHistoryRow[]> {
      const out: NormalizedHistoryRow[] = []
      let start = 0
      const afterParam = after ? after.slice(0, 10) : undefined // YYYY-MM-DD
      for (let guard = 0; guard < 2000; guard++) {
        const data = await call<TautulliHistoryData>(config, 'get_history', {
          length: PAGE, start, ...(afterParam ? { after: afterParam } : {})
        })
        const rows = data?.data ?? []
        out.push(...rows.map(normalizeRow))
        if (rows.length < PAGE) break
        start += PAGE
      }
      return out
    },
    async getUsers(): Promise<NormalizedSourceUser[]> {
      const users = await call<TautulliUser[]>(config, 'get_users')
      return (users ?? [])
        .filter(u => u.user_id != null)
        .map(u => ({
          sourceUserId: String(u.user_id),
          email: u.email ?? null,
          username: u.username ?? null,
          friendlyName: u.friendly_name ?? null
        }))
    },
    async getMetadata(ratingKey: string): Promise<NormalizedMetadata | null> {
      const data = await call<TautulliMetadata>(config, 'get_metadata', { rating_key: ratingKey })
      if (!data || !data.rating_key) return null
      const ids = parseGuids(data.guids)
      return {
        ratingKey: String(data.rating_key),
        grandparentRatingKey: data.grandparent_rating_key != null ? String(data.grandparent_rating_key) : null,
        mediaType: data.media_type ?? null,
        ...ids
      }
    }
  }
}
