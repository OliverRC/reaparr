import { sourceFetch } from './http'
import type {
  AuthInjection, ConnectionConfig, NormalizedRequest, NormalizedSourceUser, ProbeResult, SeerrClient
} from './types'

const AUTH: AuthInjection = { kind: 'header', name: 'X-Api-Key' }
const PAGE = 50

interface SeerrUser {
  id: number
  email?: string
  plexUsername?: string
  username?: string
  displayName?: string
}
interface SeerrMediaInfo { tmdbId?: number, tvdbId?: number, mediaType?: string }
interface SeerrRequest {
  id: number
  status?: number
  type?: string // 'movie'|'tv'
  createdAt?: string
  media?: SeerrMediaInfo
  requestedBy?: SeerrUser
}
interface SeerrPage<T> { pageInfo?: { pages?: number, page?: number, results?: number }, results?: T[] }

function normalizeUser(u: SeerrUser): NormalizedSourceUser {
  return {
    sourceUserId: String(u.id),
    email: u.email ?? null,
    username: u.plexUsername ?? u.username ?? null,
    friendlyName: u.displayName ?? u.username ?? null
  }
}

function normalizeRequest(r: SeerrRequest): NormalizedRequest {
  const mt = (r.type ?? r.media?.mediaType ?? 'movie') === 'tv' ? 'tv' : 'movie'
  return {
    seerrId: r.id,
    status: r.status ?? 0,
    requestedAt: r.createdAt ?? null,
    mediaType: mt,
    tmdbId: r.media?.tmdbId ?? null,
    tvdbId: r.media?.tvdbId ?? null,
    requester: r.requestedBy ? normalizeUser(r.requestedBy) : null
  }
}

export function createSeerrClient(config: ConnectionConfig): SeerrClient {
  return {
    source: 'seerr',
    async probe(): Promise<ProbeResult> {
      try {
        const status = await sourceFetch<{ version?: string }>(config, AUTH, '/api/v1/status')
        return { ok: true, message: `Seerr ${status?.version ?? ''}`.trim() }
      } catch (err) {
        return { ok: false, message: (err as Error).message }
      }
    },
    async getRequests(): Promise<NormalizedRequest[]> {
      const out: NormalizedRequest[] = []
      let skip = 0
      for (let guard = 0; guard < 1000; guard++) {
        const page = await sourceFetch<SeerrPage<SeerrRequest>>(config, AUTH, '/api/v1/request', {
          query: { take: PAGE, skip, sort: 'added' }
        })
        const results = page?.results ?? []
        out.push(...results.map(normalizeRequest))
        if (results.length < PAGE) break
        skip += PAGE
      }
      return out
    },
    async getUsers(): Promise<NormalizedSourceUser[]> {
      const out: NormalizedSourceUser[] = []
      let skip = 0
      for (let guard = 0; guard < 1000; guard++) {
        const page = await sourceFetch<SeerrPage<SeerrUser>>(config, AUTH, '/api/v1/user', {
          query: { take: PAGE, skip }
        })
        const results = page?.results ?? []
        out.push(...results.map(normalizeUser))
        if (results.length < PAGE) break
        skip += PAGE
      }
      return out
    }
  }
}
