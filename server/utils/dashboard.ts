// Assembles ranked dashboard rows from the local cache (plan §8.1). The dashboard
// never calls the four sources live — it reads SQLite.

import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db/client'

export interface DashboardRow {
  id: number
  mediaType: 'series' | 'movie'
  title: string
  year: number | null
  seasonCount: number | null
  sizeOnDisk: number
  requestedBy: string | null
  watchedBy: string[]
  lastWatchedAt: string | null
  watched: boolean
  reapScore: number
  tier: string | null
  reasons: string[]
  rating: number | null
  staleness: number
  abandonment: number
  requestMiss: number
  completion: number | null
  spared: boolean
}

export type DashboardType = 'series' | 'movie'
export type DashboardSort = 'score' | 'size'

export function getDashboard(type: DashboardType, sort: DashboardSort = 'score'): DashboardRow[] {
  const db = getDb()

  const titles = db.select().from(schema.title).where(eq(schema.title.mediaType, type)).all()
  const scores = db.select().from(schema.score).all()
  const scoreById = new Map(scores.map(s => [s.titleId, s]))

  // requested_by person name per title (first request wins).
  const requests = db.select().from(schema.request).all()
  const persons = db.select().from(schema.person).all()
  const personName = new Map(persons.map(p => [p.id, p.displayName]))
  const requestedByTitle = new Map<number, string>()
  for (const r of requests) {
    if (r.titleId == null) continue
    if (requestedByTitle.has(r.titleId)) continue
    if (r.requestedByPersonId != null) {
      const name = personName.get(r.requestedByPersonId)
      if (name) requestedByTitle.set(r.titleId, name)
    }
  }

  // watchers per title.
  const watchers = db.select().from(schema.titleWatcher).all()
  const watchersByTitle = new Map<number, string[]>()
  for (const w of watchers) {
    const name = personName.get(w.personId)
    if (!name) continue
    const arr = watchersByTitle.get(w.titleId) ?? []
    if (!arr.includes(name)) arr.push(name)
    watchersByTitle.set(w.titleId, arr)
  }

  const rows: DashboardRow[] = titles.map((t) => {
    const s = scoreById.get(t.id)
    let lastWatchedAt: string | null = null
    const items = db.select().from(schema.watchedItem).where(eq(schema.watchedItem.titleId, t.id)).all()
    for (const it of items) {
      if (it.lastWatchedAt && (!lastWatchedAt || Date.parse(it.lastWatchedAt) > Date.parse(lastWatchedAt))) {
        lastWatchedAt = it.lastWatchedAt
      }
    }
    return {
      id: t.id,
      mediaType: t.mediaType as 'series' | 'movie',
      title: t.title,
      year: t.year,
      seasonCount: t.seasonCount,
      sizeOnDisk: t.sizeOnDisk,
      requestedBy: requestedByTitle.get(t.id) ?? null,
      watchedBy: watchersByTitle.get(t.id) ?? [],
      lastWatchedAt,
      watched: items.length > 0,
      reapScore: s?.reapScore ?? 0,
      tier: s?.tier ?? null,
      reasons: s?.reasons ? JSON.parse(s.reasons) as string[] : [],
      rating: t.rating,
      staleness: s?.staleness ?? 0,
      abandonment: s?.abandonment ?? 0,
      requestMiss: s?.requestMiss ?? 0,
      completion: s?.completion ?? null,
      spared: t.spared === 1
    }
  })

  rows.sort((a, b) => {
    // Spared ("keep forever") titles always sink below reapable ones, either sort.
    if (a.spared !== b.spared) return Number(a.spared) - Number(b.spared)
    if (sort === 'size') return b.sizeOnDisk - a.sizeOnDisk || b.reapScore - a.reapScore
    return b.reapScore - a.reapScore || b.sizeOnDisk - a.sizeOnDisk
  })
  return rows
}
