// Identity resolution — pure transform (ADR-0007). Cluster on normalized email ONLY: identities
// sharing an email are one person; a no-email identity stands alone. Username and friendly_name are
// display only, never clustering keys (username may still seed an M2 Plex-login match). Deterministic:
// same input → same grouping.

export type IdentitySource = 'seerr' | 'tautulli'

export interface RawIdentity {
  source: IdentitySource
  sourceUserId: string
  username?: string | null // Plex username — display only, not a clustering key
  email?: string | null // the ONLY clustering key
  friendlyName?: string | null // display only
}

export interface ResolvedPerson {
  matchKey: string // normalized email, or 'source:sourceUserId' for a no-email single-source person
  displayName: string // source-derived (friendly_name → username → email local-part)
  identities: RawIdentity[]
}

const norm = (x?: string | null): string | null => {
  if (x == null) return null
  const t = String(x).trim().toLowerCase()
  return t.length ? t : null
}

function displayNameFor(identities: RawIdentity[]): string {
  // Tautulli friendly_name → Plex username → any friendly_name → email local-part.
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
 * Group raw identities into canonical people by normalized email. Identities sharing an email are
 * one person; a no-email identity is its own single-source person. The group's `matchKey` is the
 * normalized email, or 'source:sourceUserId' when no email is present. Pure & deterministic; the
 * result is sorted by matchKey so ordering is stable across runs.
 */
export function resolveIdentities(identities: RawIdentity[]): ResolvedPerson[] {
  const groups = new Map<string, RawIdentity[]>()
  for (const id of identities) {
    const email = norm(id.email)
    const key = email ?? `${id.source}:${id.sourceUserId}`
    ;(groups.get(key) ?? groups.set(key, []).get(key)!).push(id)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([matchKey, ids]) => ({ matchKey, displayName: displayNameFor(ids), identities: ids }))
}
