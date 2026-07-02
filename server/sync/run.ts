// Sync orchestrator (plan §5). Fetches normalized data from each configured
// source into a bundle, then hands off to persistBundle for join/identity/score.
// A failed source degrades the run to 'partial'; it never aborts the whole run.

import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db/client'
import {
  createRadarrClient, createSeerrClient, createSonarrClient, createTautulliClient,
  type ConnectionConfig, type NormalizedHistoryRow, type NormalizedMetadata,
  type NormalizedMovie, type NormalizedRequest, type NormalizedSeries, type NormalizedSourceUser
} from '../sources'
import { persistBundle, type SyncBundle } from './persist'
import { runReapingTick } from '../reaping/tick'

export interface SyncResult {
  runId: number
  status: 'ok' | 'partial' | 'error'
  counts: Record<string, unknown>
  errors: Record<string, string>
}

let _running: Promise<SyncResult> | null = null

function connConfig(row: { baseUrl: string | null, credential: string | null }): ConnectionConfig | null {
  if (!row.baseUrl || !row.credential) return null
  return { baseUrl: row.baseUrl, credential: row.credential }
}

export function isSyncRunning(): boolean {
  return _running !== null
}

export async function runSync(now: number = Date.now()): Promise<SyncResult> {
  if (_running) return _running
  _running = doRun(now).finally(() => {
    _running = null
  })
  return _running
}

async function doRun(now: number): Promise<SyncResult> {
  const db = getDb()
  const startedAt = new Date(now).toISOString()
  const runIns = db.insert(schema.syncRun).values({ startedAt, status: 'running' }).run()
  const runId = Number(runIns.lastInsertRowid)

  const errors: Record<string, string> = {}
  const fetched: Record<string, number> = {}

  const conns = db.select().from(schema.sourceConnection).all()
  const bySource = new Map(conns.map(c => [c.source, c]))

  const enabled = (s: string) => {
    const c = bySource.get(s)
    return c && c.enabled === 1 ? connConfig(c) : null
  }

  // --- Sonarr / Radarr (titles) ---------------------------------------------
  let series: NormalizedSeries[] = []
  const sonarrCfg = enabled('sonarr')
  if (sonarrCfg) {
    try {
      series = await createSonarrClient(sonarrCfg).getSeries()
      fetched.series = series.length
    } catch (err) { errors.sonarr = (err as Error).message }
  }

  let movies: NormalizedMovie[] = []
  const radarrCfg = enabled('radarr')
  if (radarrCfg) {
    try {
      movies = await createRadarrClient(radarrCfg).getMovies()
      fetched.movies = movies.length
    } catch (err) { errors.radarr = (err as Error).message }
  }

  // --- Seerr (users + requests) ---------------------------------------------
  let seerrUsers: NormalizedSourceUser[] = []
  let requests: NormalizedRequest[] = []
  const seerrCfg = enabled('seerr')
  if (seerrCfg) {
    const client = createSeerrClient(seerrCfg)
    try {
      seerrUsers = await client.getUsers()
      fetched.seerrUsers = seerrUsers.length
    } catch (err) { errors.seerr = (err as Error).message }
    try {
      requests = await client.getRequests()
      fetched.requests = requests.length
    } catch (err) { errors.seerr = (err as Error).message }
  }

  // --- Tautulli (users + history + metadata) --------------------------------
  let tautulliUsers: NormalizedSourceUser[] = []
  let history: NormalizedHistoryRow[] = []
  let resolveMetadata: (key: string) => Promise<NormalizedMetadata | null> = async () => null
  const tautCfg = enabled('tautulli')
  if (tautCfg) {
    const client = createTautulliClient(tautCfg)
    try {
      tautulliUsers = await client.getUsers()
      fetched.tautulliUsers = tautulliUsers.length
    } catch (err) { errors.tautulli = (err as Error).message }
    try {
      history = await client.getHistory() // full pull — persist rebuilds watches each run
      fetched.history = history.length
      resolveMetadata = (key: string) => client.getMetadata(key)
    } catch (err) { errors.tautulli = (err as Error).message }
  }

  // Fetch-guard (docs/adr/0002): a source is authoritative for the data derived from it only if it
  // was enabled AND its fetch succeeded. A failed/disabled source must never wipe its tables —
  // titles (sonarr/radarr), requests + identities (seerr), watches + identities (tautulli). Seerr
  // sets a single error for either the users or requests pull, so any Seerr failure conservatively
  // preserves both its requests and its identities.
  const bundle: SyncBundle = {
    series, movies, seerrUsers, tautulliUsers, requests, history, resolveMetadata,
    sourcesOk: {
      sonarr: !!sonarrCfg && !errors.sonarr,
      radarr: !!radarrCfg && !errors.radarr,
      seerr: !!seerrCfg && !errors.seerr,
      tautulli: !!tautCfg && !errors.tautulli
    }
  }

  let counts: Record<string, unknown> = {}
  let status: SyncResult['status'] = 'ok'
  try {
    counts = { ...fetched, ...(await persistBundle(bundle, now)) }
    // Advance the reaping clock (auto-reprieve on watch, due flip, opt-in reminder).
    counts = { ...counts, reaping: await runReapingTick(getDb(), now) }
  } catch (err) {
    errors.persist = (err as Error).message
    status = 'error'
  }

  if (status !== 'error' && Object.keys(errors).length > 0) status = 'partial'

  const finishedAt = new Date().toISOString()
  db.update(schema.syncRun).set({
    finishedAt, status,
    countsJson: JSON.stringify(counts),
    error: Object.keys(errors).length ? JSON.stringify(errors) : null
  }).where(eq(schema.syncRun.id, runId)).run()

  // Stamp per-source last-synced / status.
  for (const c of conns) {
    if (c.enabled !== 1) continue
    const err = errors[c.source]
    db.update(schema.sourceConnection).set({
      lastSyncedAt: finishedAt,
      lastStatus: err ? 'error' : 'ok',
      lastError: err ?? null
    }).where(eq(schema.sourceConnection.source, c.source)).run()
  }

  return { runId, status, counts, errors }
}
