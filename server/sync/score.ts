// Reap Score v1 — pure, fully unit-testable (no I/O). See spec §8.5 / plan §7.
//
// raw       = S + A + R                            // 0..100
// freshness = clamp(age_days / GRACE_DAYS, 0, 1)
// ReapScore = round(raw × freshness)
//
// Weights 50/30/20 are fixed. Only ScoringConfig (tier boundaries + grace) is tunable.

export interface ScoringConfig {
  graceDays: number // 30
  staleT1: number // 90  (3 mo)
  staleT2: number // 180 (6 mo)
  staleT3: number // 365 (12 mo)
}

export const DEFAULT_SCORING: ScoringConfig = {
  graceDays: 30,
  staleT1: 90,
  staleT2: 180,
  staleT3: 365
}

export type Tier = 'fresh' | 'stale' | 'very_stale' | 'dormant'

export interface TitleFacts {
  mediaType: 'series' | 'movie'
  title: string
  addedAt: string | null // ISO; null tolerated (treated as very old)
  watched: boolean // EXISTS watched_item
  lastWatchedAt: string | null // MAX(watched_item.last_watched_at)
  completion: number // series: distinct watched ÷ downloaded episodes; movie: 1/0.5/0
  requested: boolean // EXISTS request for this title
  requestedByName?: string | null // for reason chips only
  seriesAiring?: boolean // series_status == 'continuing'
}

export interface ScoreResult {
  reap: number
  S: number
  A: number
  R: number
  idleDays: number
  completion: number
  freshness: number
  tier: Tier
  reasons: string[]
}

const DAY_MS = 86_400_000

export function daysBetween(iso: string | null, now: number): number {
  if (!iso) return 99999 // unknown/missing → treat as very old
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 99999
  return Math.max(0, Math.floor((now - t) / DAY_MS))
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export function stalenessRamp(idleDays: number, c: ScoringConfig): number {
  if (idleDays < c.staleT1) return 0
  if (idleDays < c.staleT2) return 1 / 3 // Stale
  if (idleDays < c.staleT3) return 2 / 3 // Very stale
  return 1 // Dormant
}

export function tierLabel(idleDays: number, c: ScoringConfig): Tier {
  if (idleDays < c.staleT1) return 'fresh'
  if (idleDays < c.staleT2) return 'stale'
  if (idleDays < c.staleT3) return 'very_stale'
  return 'dormant'
}

export const TIER_TEXT: Record<Tier, string> = {
  fresh: 'Fresh',
  stale: 'Stale',
  very_stale: 'Very stale',
  dormant: 'Dormant'
}

function humanizeIdle(idleDays: number): string {
  if (idleDays >= 99999) return 'unknown'
  if (idleDays < 45) return `${idleDays} days`
  const months = Math.round(idleDays / 30)
  if (months < 18) return `${months} months`
  return `${Math.round(idleDays / 365 * 10) / 10} years`
}

function buildReasons(f: TitleFacts, idleDays: number): string[] {
  const reasons: string[] = []

  // 1. Watch-recency / never-watched chip (the dominant staleness signal).
  if (!f.watched) {
    reasons.push(`Never watched · on server ${humanizeIdle(idleDays)}`)
  } else {
    reasons.push(`Last watched ${humanizeIdle(idleDays)} ago`)
  }

  // 2. Engagement / abandonment chip.
  if (f.watched) {
    if (f.completion >= 0.95) reasons.push('Finished')
    else if (f.completion <= 0.05) reasons.push('Barely started')
    else reasons.push(`Watched ~${Math.round(f.completion * 100)}%`)
  }

  // 3. Request chip.
  if (f.requested) {
    const by = f.requestedByName ? ` by ${f.requestedByName}` : ''
    if (!f.watched) reasons.push(`Requested${by}, never followed through`)
    else reasons.push(`Requested${by}`)
  }

  return reasons
}

export function reapScore(f: TitleFacts, c: ScoringConfig = DEFAULT_SCORING, now: number = Date.now()): ScoreResult {
  const idleDays = daysBetween(f.watched ? f.lastWatchedAt : f.addedAt, now)
  const completion = clamp(f.completion, 0, 1)

  const S = Math.round(50 * stalenessRamp(idleDays, c))
  const A = Math.round(30 * (1 - completion))
  const R = (f.requested && !f.watched) ? 20 : 0
  const raw = S + A + R

  const ageDays = daysBetween(f.addedAt, now)
  const freshness = clamp(ageDays / c.graceDays, 0, 1)
  const reap = Math.round(raw * freshness)

  return {
    reap,
    S,
    A,
    R,
    idleDays,
    completion,
    freshness,
    tier: tierLabel(idleDays, c),
    reasons: buildReasons(f, idleDays)
  }
}
