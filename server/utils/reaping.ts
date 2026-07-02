// Read models for the reaping surfaces (The Sands, The Appointed Hour) and per-title history.
// Reads SQLite only; never calls a source live. Voice labels are applied by the frontend.

import { eq, inArray } from 'drizzle-orm'
import { getDb, schema } from '../db/client'

export interface ReapingRow {
  id: number
  mediaType: 'series' | 'movie'
  title: string
  year: number | null
  sizeOnDisk: number
  reapScore: number
  tier: string | null
  state: string
  episode: number
  scheduledAt: string | null
  dueAt: string | null
  sendReminder: boolean
  appellants: string[]
  requestedBy: string | null
  watchedBy: string[]
  links: { sonarr: string | null, radarr: string | null, tautulli: string | null }
}

function baseUrls(db: ReturnType<typeof getDb>) {
  const conns = db.select().from(schema.sourceConnection).all()
  const base = (src: string) => {
    const c = conns.find(x => x.source === src)
    return c?.baseUrl ? c.baseUrl.replace(/\/+$/, '') : null
  }
  return { sonarr: base('sonarr'), radarr: base('radarr'), tautulli: base('tautulli') }
}

// Titles in the given lifecycle states, with schedule/appeal/connection context and deep links.
export function getReapingList(states: string[]): ReapingRow[] {
  const db = getDb()
  const titles = db.select().from(schema.title).where(inArray(schema.title.state, states)).all()
  if (titles.length === 0) return []

  const scoreById = new Map(db.select().from(schema.score).all().map(s => [s.titleId, s]))
  const persons = db.select().from(schema.person).all()
  const personName = new Map(persons.map(p => [p.id, p.displayName]))
  const bases = baseUrls(db)

  const requests = db.select().from(schema.request).all()
  const requestedBy = new Map<number, string>()
  for (const r of requests) {
    if (r.titleId == null || requestedBy.has(r.titleId) || r.requestedByPersonId == null) continue
    const name = personName.get(r.requestedByPersonId)
    if (name) requestedBy.set(r.titleId, name)
  }

  const watchers = db.select().from(schema.titleWatcher).all()
  const watchersByTitle = new Map<number, string[]>()
  for (const w of watchers) {
    const name = personName.get(w.personId)
    if (!name) continue
    const arr = watchersByTitle.get(w.titleId) ?? []
    if (!arr.includes(name)) arr.push(name)
    watchersByTitle.set(w.titleId, arr)
  }

  return titles.map((t) => {
    const s = scoreById.get(t.id)
    // Appellants: members who raised an appeal in the CURRENT episode.
    const appellants = db.select().from(schema.titleTransition)
      .where(eq(schema.titleTransition.titleId, t.id)).all()
      .filter(tr => tr.reason === 'member_appealed' && tr.episode === t.episode && tr.actorPersonId != null)
      .map(tr => personName.get(tr.actorPersonId!) ?? 'Unknown')
    return {
      id: t.id,
      mediaType: t.mediaType as 'series' | 'movie',
      title: t.title,
      year: t.year,
      sizeOnDisk: t.sizeOnDisk,
      reapScore: s?.reapScore ?? 0,
      tier: s?.tier ?? null,
      state: t.state,
      episode: t.episode,
      scheduledAt: t.scheduledAt,
      dueAt: t.dueAt,
      sendReminder: t.sendReminder === 1,
      appellants: [...new Set(appellants)],
      requestedBy: requestedBy.get(t.id) ?? null,
      watchedBy: watchersByTitle.get(t.id) ?? [],
      links: {
        sonarr: (t.mediaType === 'series' && bases.sonarr && t.titleSlug) ? `${bases.sonarr}/series/${t.titleSlug}` : null,
        radarr: (t.mediaType === 'movie' && bases.radarr && t.tmdbId) ? `${bases.radarr}/movie/${t.tmdbId}` : null,
        tautulli: (bases.tautulli && t.tautulliKey) ? `${bases.tautulli}/info?rating_key=${t.tautulliKey}` : null
      }
    }
  })
}

export interface TransitionEntry {
  reason: string
  fromState: string
  toState: string
  actor: string // person display name or 'sync'/'system'
  createdAt: string
  metadata: Record<string, unknown> | null
}

export interface EpisodeHistory {
  episode: number
  transitions: TransitionEntry[]
}

// Per-title transition history, grouped by episode (Life 1 / Life 2 …).
export function getTitleHistory(titleId: number): EpisodeHistory[] {
  const db = getDb()
  const persons = db.select().from(schema.person).all()
  const personName = new Map(persons.map(p => [p.id, p.displayName]))
  const rows = db.select().from(schema.titleTransition)
    .where(eq(schema.titleTransition.titleId, titleId)).all()
    .sort((a, b) => a.id - b.id)

  const byEpisode = new Map<number, TransitionEntry[]>()
  for (const r of rows) {
    const actor = r.actorPersonId != null ? (personName.get(r.actorPersonId) ?? 'Unknown') : (r.actorSystem ?? 'system')
    const entry: TransitionEntry = {
      reason: r.reason,
      fromState: r.fromState,
      toState: r.toState,
      actor,
      createdAt: r.createdAt,
      metadata: r.metadata ? JSON.parse(r.metadata) as Record<string, unknown> : null
    }
    const arr = byEpisode.get(r.episode) ?? []
    arr.push(entry)
    byEpisode.set(r.episode, arr)
  }
  return [...byEpisode.entries()].sort((a, b) => a[0] - b[0]).map(([episode, transitions]) => ({ episode, transitions }))
}
