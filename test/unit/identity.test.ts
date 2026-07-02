import { describe, it, expect } from 'vitest'
import { resolveIdentities, type RawIdentity } from '../../server/sync/identity'

const seerr = (id: string, p: Partial<RawIdentity>): RawIdentity => ({ source: 'seerr', sourceUserId: id, ...p })
const taut = (id: string, p: Partial<RawIdentity>): RawIdentity => ({ source: 'tautulli', sourceUserId: id, ...p })

function personFor(people: ReturnType<typeof resolveIdentities>, source: string, sourceUserId: string) {
  return people.find(p => p.identities.some(i => i.source === source && i.sourceUserId === sourceUserId))
}

describe('identity resolution — email-only (ADR-0007)', () => {
  it('links Seerr↔Tautulli when email matches (case-insensitive), keyed by the email', () => {
    const people = resolveIdentities([
      seerr('s1', { email: 'Alice@Example.com', username: 'alice' }),
      taut('t1', { email: 'alice@example.com', username: 'alice', friendlyName: 'Alice' })
    ])
    expect(people).toHaveLength(1)
    expect(people[0]!.identities).toHaveLength(2)
    expect(people[0]!.matchKey).toBe('alice@example.com')
    expect(people[0]!.displayName).toBe('Alice') // friendly_name wins
  })

  it('does NOT link on username alone — email is the only clustering key', () => {
    const people = resolveIdentities([
      seerr('s1', { username: 'bob', email: null }),
      taut('t1', { username: 'bob', email: 'bob@plex.tv' })
    ])
    expect(people).toHaveLength(2)
    expect(personFor(people, 'seerr', 's1')!.matchKey).toBe('seerr:s1') // no-email → keyed by identity
    expect(personFor(people, 'tautulli', 't1')!.matchKey).toBe('bob@plex.tv')
  })

  it('never matches on friendly_name', () => {
    const people = resolveIdentities([
      seerr('s1', { username: 'carol', email: 'carol@a.com' }),
      taut('t1', { username: 'different', email: 'other@b.com', friendlyName: 'carol' })
    ])
    expect(people).toHaveLength(2)
  })

  it('groups two sources sharing an email into ONE person — no conflict state', () => {
    // Formerly a needs_review conflict under email-OR-username; email-only makes it a clean match.
    const people = resolveIdentities([
      seerr('S', { email: 'shared@x.com', username: 'eve' }),
      taut('T1', { email: 'shared@x.com', username: 'mallory' })
    ])
    expect(people).toHaveLength(1)
    expect(people[0]!.identities).toHaveLength(2)
    expect(people[0]!.matchKey).toBe('shared@x.com')
  })

  it('keeps a watcher with no Seerr account as a valid single-source person', () => {
    const people = resolveIdentities([
      taut('t99', { username: 'lonewatcher', email: 'lone@plex.tv', friendlyName: 'Lone Watcher' })
    ])
    expect(people).toHaveLength(1)
    expect(people[0]!.matchKey).toBe('lone@plex.tv')
    expect(people[0]!.displayName).toBe('Lone Watcher')
  })

  it('keeps distinct emails as distinct people', () => {
    const people = resolveIdentities([
      seerr('s1', { email: 'a@a.com', username: 'aaa' }),
      taut('t1', { email: 'a@a.com', username: 'aaa' }),
      seerr('s2', { email: 'b@b.com', username: 'bbb' }),
      taut('t2', { email: 'b@b.com', username: 'bbb' })
    ])
    expect(people).toHaveLength(2)
    expect(people.every(p => p.identities.length === 2)).toBe(true)
  })

  it('is deterministic — result sorted by matchKey', () => {
    const people = resolveIdentities([taut('t1', { email: 'z@z.com' }), seerr('s1', { email: 'a@a.com' })])
    expect(people.map(p => p.matchKey)).toEqual(['a@a.com', 'z@z.com'])
  })

  it('falls back to the email local-part for display when no friendly/username', () => {
    const people = resolveIdentities([seerr('s1', { email: 'zoe@x.com' })])
    expect(people[0]!.displayName).toBe('zoe')
  })
})
