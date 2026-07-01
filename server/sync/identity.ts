// Identity auto-match — pure transform (spec §6.2 / plan §6).
// Match on email OR Plex username, case-insensitive/trimmed.
// Conflicts (email→A, username→B with A≠B) → flagged needs_review, no link.
// Never match on friendly_name.

export type IdentitySource = 'seerr' | 'tautulli'

export interface RawIdentity {
  source: IdentitySource
  sourceUserId: string
  username?: string | null // Plex username (match key)
  email?: string | null // match key
  friendlyName?: string | null // display only — NEVER a match key
}

export type MatchStatus = 'auto' | 'confirmed' | 'needs_review'

export interface ResolvedPerson {
  key: number // temporary id local to this pass; the DB assigns real ids
  displayName: string
  matchStatus: MatchStatus
  identities: RawIdentity[]
}

const norm = (x?: string | null): string | null => {
  if (x == null) return null
  const t = String(x).trim().toLowerCase()
  return t.length ? t : null
}

function displayNameFor(identities: RawIdentity[]): string {
  // spec §6.1: Tautulli friendly_name → Plex username → email local-part
  const tautFn = identities.find(i => i.source === 'tautulli' && i.friendlyName && i.friendlyName.trim())?.friendlyName
  if (tautFn) return tautFn.trim()
  const un = identities.find(i => i.username && i.username.trim())?.username
  if (un) return un.trim()
  const anyFn = identities.find(i => i.friendlyName && i.friendlyName.trim())?.friendlyName
  if (anyFn) return anyFn.trim()
  const em = identities.find(i => i.email && i.email.trim())?.email
  if (em) return em.split('@')[0]!
  return 'Unknown'
}

/**
 * Resolve raw identities (Seerr getUsers + Tautulli getUsers) into canonical people.
 * Pure & deterministic: same input → same grouping.
 */
export function resolveIdentities(identities: RawIdentity[]): ResolvedPerson[] {
  const n = identities.length

  // Index by normalized email / username.
  const byEmail = new Map<string, number[]>()
  const byUser = new Map<string, number[]>()
  identities.forEach((id, i) => {
    const e = norm(id.email)
    const u = norm(id.username)
    if (e) (byEmail.get(e) ?? byEmail.set(e, []).get(e)!).push(i)
    if (u) (byUser.get(u) ?? byUser.set(u, []).get(u)!).push(i)
  })

  const otherSourceMatches = (i: number, idx: Map<string, number[]>, k: string | null): number[] =>
    (k ? idx.get(k)! : []).filter(j => j !== i && identities[j]!.source !== identities[i]!.source)

  // --- Pass 1: detect conflicts -------------------------------------------------
  // A conflict is: email matches a different other-source identity than username does.
  const conflicted = new Set<number>()
  identities.forEach((id, i) => {
    const emailMatches = otherSourceMatches(i, byEmail, norm(id.email))
    const userMatches = otherSourceMatches(i, byUser, norm(id.username))
    if (emailMatches.length && userMatches.length) {
      const emailTargets = new Set(emailMatches)
      const agree = userMatches.some(t => emailTargets.has(t))
      if (!agree) {
        conflicted.add(i)
        emailMatches.forEach(j => conflicted.add(j))
        userMatches.forEach(j => conflicted.add(j))
      }
    }
  })

  // --- Pass 2: union non-conflicted identities on their matches -----------------
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!
      i = parent[i]!
    }
    return i
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
  }

  identities.forEach((id, i) => {
    if (conflicted.has(i)) return
    const matches = [
      ...otherSourceMatches(i, byEmail, norm(id.email)),
      ...otherSourceMatches(i, byUser, norm(id.username))
    ]
    matches.forEach((j) => {
      if (!conflicted.has(j)) union(i, j)
    })
  })

  // --- Group by union-find root -------------------------------------------------
  const groups = new Map<number, number[]>()
  identities.forEach((_, i) => {
    const r = find(i)
    ;(groups.get(r) ?? groups.set(r, []).get(r)!).push(i)
  })

  const people: ResolvedPerson[] = []
  let key = 0
  for (const [, members] of groups) {
    const ids = members.map(m => identities[m]!)
    const hasConflict = members.some(m => conflicted.has(m))
    people.push({
      key: key++,
      displayName: displayNameFor(ids),
      matchStatus: hasConflict ? 'needs_review' : 'auto',
      identities: ids
    })
  }
  return people
}
