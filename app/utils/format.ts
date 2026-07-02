export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const val = bytes / Math.pow(1024, i)
  return `${val >= 100 || i === 0 ? Math.round(val) : val.toFixed(1)} ${units[i]}`
}

// Quick-filter predicate for the dashboard table: case-insensitive substring
// match on the title. An empty/whitespace query matches everything (no filter).
export function matchesTitleQuery(title: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return title.toLowerCase().includes(q)
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 'never'
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days < 1) return 'today'
  if (days < 30) return `${days}d ago`
  const months = Math.round(days / 30)
  if (months < 18) return `${months}mo ago`
  return `${(days / 365).toFixed(1)}y ago`
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export type ReapTier = 'fresh' | 'stale' | 'very_stale' | 'dormant'

export interface TierMeta { label: string, color: 'neutral' | 'warning' | 'error' | 'success' }

export function tierMeta(tier: string | null): TierMeta {
  switch (tier) {
    case 'dormant': return { label: 'Dormant', color: 'error' }
    case 'very_stale': return { label: 'Very stale', color: 'error' }
    case 'stale': return { label: 'Stale', color: 'warning' }
    default: return { label: 'Fresh', color: 'success' }
  }
}

// Reap Score → badge color band (higher = stronger deletion candidate).
export function scoreColor(score: number): 'neutral' | 'warning' | 'error' | 'success' {
  if (score >= 80) return 'error'
  if (score >= 40) return 'warning'
  if (score >= 1) return 'neutral'
  return 'success'
}

// Quality rating (0–10) → badge color band (higher = better show/movie).
export function ratingColor(rating: number | null): 'neutral' | 'warning' | 'error' | 'success' {
  if (rating == null) return 'neutral'
  if (rating >= 7) return 'success'
  if (rating >= 5) return 'warning'
  return 'error'
}
