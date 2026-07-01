import { describe, it, expect } from 'vitest'
import { resolveIdentities, type RawIdentity } from '../../server/sync/identity'

const seerr = (id: string, p: Partial<RawIdentity>): RawIdentity => ({ source: 'seerr', sourceUserId: id, ...p })
const taut = (id: string, p: Partial<RawIdentity>): RawIdentity => ({ source: 'tautulli', sourceUserId: id, ...p })

function personFor(people: ReturnType<typeof resolveIdentities>, source: string, sourceUserId: string) {
  return people.find(p => p.identities.some(i => i.source === source && i.sourceUserId === sourceUserId))
}

describe('identity auto-match', () => {
  it('links Seerr↔Tautulli when email matches (case-insensitive)', () => {
    const people = resolveIdentities([
      seerr('s1', { email: 'Alice@Example.com', username: 'alice' }),
      taut('t1', { email: 'alice@example.com', username: 'alice', friendlyName: 'Alice' })
    ])
    expect(people).toHaveLength(1)
    expect(people[0]!.identities).toHaveLength(2)
    expect(people[0]!.matchStatus).toBe('auto')
    expect(people[0]!.displayName).toBe('Alice') // friendly_name wins
  })

  it('links when only username matches (emails null/differ but one is null)', () => {
    const people = resolveIdentities([
      seerr('s1', { username: 'Bob', email: null }),
      taut('t1', { username: 'bob', email: 'bob@plex.tv' })
    ])
    expect(people).toHaveLength(1)
    expect(people[0]!.matchStatus).toBe('auto')
  })

  it('NEVER matches on friendly_name', () => {
    const people = resolveIdentities([
      seerr('s1', { username: 'carol', email: 'carol@a.com' }),
      taut('t1', { username: 'different', email: 'other@b.com', friendlyName: 'carol' })
    ])
    expect(people).toHaveLength(2) // not linked despite friendly_name == seerr username
  })

  it('flags a genuine conflict as needs_review (email→A, username→B)', () => {
    // Seerr S: email=a@x, username=alice
    // Tautulli T1: email=a@x (matches S email), username=bob
    // Tautulli T2: email=c@y, username=alice (matches S username)
    const people = resolveIdentities([
      seerr('S', { email: 'a@x.com', username: 'alice' }),
      taut('T1', { email: 'a@x.com', username: 'bob' }),
      taut('T2', { email: 'c@y.com', username: 'alice' })
    ])
    const ps = personFor(people, 'seerr', 'S')
    expect(ps!.matchStatus).toBe('needs_review')
    // The conflicting identity must NOT be silently linked to either partner.
    expect(ps!.identities.filter(i => i.source === 'tautulli')).toHaveLength(0)
  })

  it('keeps a watcher with no Seerr account as a valid single-source person', () => {
    const people = resolveIdentities([
      taut('t99', { username: 'lonewatcher', email: 'lone@plex.tv', friendlyName: 'Lone Watcher' })
    ])
    expect(people).toHaveLength(1)
    expect(people[0]!.matchStatus).toBe('auto')
    expect(people[0]!.displayName).toBe('Lone Watcher')
  })

  it('does not merge two distinct people', () => {
    const people = resolveIdentities([
      seerr('s1', { email: 'a@a.com', username: 'aaa' }),
      taut('t1', { email: 'a@a.com', username: 'aaa' }),
      seerr('s2', { email: 'b@b.com', username: 'bbb' }),
      taut('t2', { email: 'b@b.com', username: 'bbb' })
    ])
    expect(people).toHaveLength(2)
    expect(people.every(p => p.identities.length === 2)).toBe(true)
  })
})
