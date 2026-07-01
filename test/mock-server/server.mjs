// Mock source server (spec §12.3). Serves the canonical demo dataset at each
// source's REAL API paths + auth shapes, so the adapters, Test-connection, and
// full sync code paths run end-to-end with zero credentials.
//
//   node test/mock-server/server.mjs          # all four sources on one port
//   MOCK_PORT=8900 node test/mock-server/server.mjs
//
// Point every connection's base URL at http://localhost:<port> and use any
// non-empty API key.

import { createServer } from 'node:http'
import { buildDemoBundle } from '../../server/utils/demo-dataset.ts'

const PORT = Number(process.env.MOCK_PORT || 8900)
const VERSION = '1.0.0-mock'
// Pin "now" for deterministic tests; default to wall clock for interactive use.
const NOW = process.env.MOCK_NOW ? Number(process.env.MOCK_NOW) : null
const isoToEpoch = iso => (iso ? Math.floor(Date.parse(iso) / 1000) : 0)

function reshapeSeries(s) {
  return {
    id: s.sourceId, title: s.title, year: s.year, tvdbId: s.tvdbId, tmdbId: s.tmdbId, imdbId: s.imdbId,
    titleSlug: s.title.toLowerCase().replace(/\s+/g, '-'), added: s.addedAt, status: s.status,
    ended: s.status === 'ended', seriesType: s.seriesType,
    ratings: { votes: 100, value: s.rating },
    statistics: {
      seasonCount: s.seasonCount, episodeFileCount: s.downloadedEpisodes, episodeCount: s.downloadedEpisodes,
      totalEpisodeCount: s.downloadedEpisodes, sizeOnDisk: s.sizeOnDisk, percentOfEpisodes: 100
    },
    seasons: s.seasons.map(se => ({ seasonNumber: se.seasonNumber, statistics: { sizeOnDisk: se.sizeOnDisk, episodeFileCount: se.episodeFiles } }))
  }
}
function reshapeMovie(m) {
  return { id: m.sourceId, title: m.title, year: m.year, tmdbId: m.tmdbId, imdbId: m.imdbId, sizeOnDisk: m.sizeOnDisk, hasFile: m.hasFile, added: m.addedAt, ratings: { tmdb: { value: m.rating }, imdb: { value: m.ratingImdb }, rottenTomatoes: { value: m.ratingRt } }, statistics: { sizeOnDisk: m.sizeOnDisk } }
}
function reshapeSeerrUser(u) {
  return { id: Number(u.sourceUserId), email: u.email, plexUsername: u.username, username: u.username, displayName: u.friendlyName }
}
function reshapeRequest(r) {
  return { id: r.seerrId, status: r.status, type: r.mediaType, createdAt: r.requestedAt, media: { tmdbId: r.tmdbId, tvdbId: r.tvdbId, mediaType: r.mediaType }, requestedBy: r.requester ? reshapeSeerrUser(r.requester) : null }
}
function reshapeHistoryRow(h) {
  return { date: isoToEpoch(h.lastWatchedAt), stopped: isoToEpoch(h.lastWatchedAt), user_id: Number(h.userId), user: h.username, friendly_name: h.friendlyName, media_type: h.mediaType, rating_key: Number(h.ratingKey), grandparent_rating_key: h.grandparentRatingKey != null ? Number(h.grandparentRatingKey) : null, watched_status: h.watchedStatus, percent_complete: h.percentComplete }
}
function reshapeTautUser(u) {
  return { user_id: Number(u.sourceUserId), username: u.username, friendly_name: u.friendlyName, email: u.email }
}
function guidsFor(m) {
  const g = []
  if (m.imdbId) g.push(`imdb://${m.imdbId}`)
  if (m.tmdbId) g.push(`tmdb://${m.tmdbId}`)
  if (m.tvdbId) g.push(`tvdb://${m.tvdbId}`)
  return g
}

function send(res, status, body) {
  const json = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(json)
}

async function handle(req, res) {
  const bundle = buildDemoBundle(NOW ?? Date.now())
  const u = new URL(req.url, `http://localhost:${PORT}`)
  const path = u.pathname
  const q = u.searchParams

  // --- Sonarr ---------------------------------------------------------------
  if (path === '/api/v3/system/status') {
    // Shared by Sonarr & Radarr probes.
    return send(res, 200, { appName: 'Mock', version: VERSION })
  }
  if (path === '/api/v3/series') {
    return send(res, 200, bundle.series.map(reshapeSeries))
  }
  if (path === '/api/v3/movie') {
    return send(res, 200, bundle.movies.map(reshapeMovie))
  }

  // --- Seerr ----------------------------------------------------------------
  if (path === '/api/v1/status') {
    return send(res, 200, { version: VERSION })
  }
  if (path === '/api/v1/request') {
    const take = Number(q.get('take') || 50)
    const skip = Number(q.get('skip') || 0)
    const all = bundle.requests.map(reshapeRequest)
    const page = all.slice(skip, skip + take)
    return send(res, 200, { pageInfo: { pages: Math.ceil(all.length / take), page: skip / take + 1, results: all.length }, results: page })
  }
  if (path === '/api/v1/user') {
    const take = Number(q.get('take') || 50)
    const skip = Number(q.get('skip') || 0)
    const all = bundle.seerrUsers.map(reshapeSeerrUser)
    const page = all.slice(skip, skip + take)
    return send(res, 200, { pageInfo: { pages: Math.ceil(all.length / take), results: all.length }, results: page })
  }

  // --- Tautulli (cmd-style) -------------------------------------------------
  if (path === '/api/v2') {
    const apikey = q.get('apikey')
    if (!apikey) return send(res, 200, { response: { result: 'error', message: 'Invalid apikey' } })
    const cmd = q.get('cmd')
    if (cmd === 'get_server_info') {
      return send(res, 200, { response: { result: 'success', data: { pms_name: 'MockPlex', pms_version: VERSION } } })
    }
    if (cmd === 'get_users') {
      return send(res, 200, { response: { result: 'success', data: bundle.tautulliUsers.map(reshapeTautUser) } })
    }
    if (cmd === 'get_history') {
      const length = Number(q.get('length') || 100)
      const start = Number(q.get('start') || 0)
      const after = q.get('after')
      let rows = bundle.history.map(reshapeHistoryRow)
      if (after) {
        const cutoff = Date.parse(`${after}T00:00:00Z`) / 1000
        rows = rows.filter(r => r.stopped >= cutoff)
      }
      const page = rows.slice(start, start + length)
      return send(res, 200, { response: { result: 'success', data: { recordsFiltered: rows.length, recordsTotal: rows.length, data: page } } })
    }
    if (cmd === 'get_metadata') {
      const ratingKey = q.get('rating_key')
      const m = ratingKey ? await bundle.resolveMetadata(ratingKey) : null
      if (!m) return send(res, 200, { response: { result: 'success', data: {} } })
      return send(res, 200, { response: { result: 'success', data: { rating_key: m.ratingKey, grandparent_rating_key: m.grandparentRatingKey, media_type: m.mediaType, guids: guidsFor(m) } } })
    }
    return send(res, 200, { response: { result: 'error', message: `Unknown cmd ${cmd}` } })
  }

  send(res, 404, { error: 'not found', path })
}

createServer((req, res) => {
  handle(req, res).catch((err) => {
    send(res, 500, { error: String(err?.message || err) })
  })
}).listen(PORT, () => {
  console.log(`[mock] Reaparr mock source server on http://localhost:${PORT}`)
  console.log('[mock] Sonarr/Radarr: /api/v3/* · Seerr: /api/v1/* · Tautulli: /api/v2?cmd=...')
})
