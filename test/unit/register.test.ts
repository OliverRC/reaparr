import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RawIdentity } from '../../server/sync/identity'

// Isolate the DB to a temp file BEFORE the client opens it (path is read lazily).
process.env.REAPARR_DB_PATH = join(mkdtempSync(join(tmpdir(), 'reaparr-register-')), 'test.db')

async function ctx() {
  const { getDb, schema } = await import('../../server/db/client')
  const reg = await import('../../server/people/register')
  const { eq } = await import('drizzle-orm')
  return { db: getDb(), schema, eq, ...reg }
}

const ALL = new Set(['seerr', 'tautulli'] as const)
const seerr = (id: string, email: string | null, p: Partial<RawIdentity> = {}): RawIdentity =>
  ({ source: 'seerr', sourceUserId: id, email, ...p })
const taut = (id: string, email: string | null, p: Partial<RawIdentity> = {}): RawIdentity =>
  ({ source: 'tautulli', sourceUserId: id, email, ...p })

// The canonical Alice cluster reused across tests.
const ALICE = [seerr('1', 'a@x.com', { username: 'al' }), taut('11', 'a@x.com', { friendlyName: 'Al' })]

describe('reconcile — person register (ADR-0007)', () => {
  it('creates one person per email cluster, keyed by match_key', async () => {
    const { db, schema, reconcile } = await ctx()
    reconcile(db, ALICE, ALL)
    const people = db.select().from(schema.person).all()
    expect(people).toHaveLength(1)
    expect(people[0]!.matchKey).toBe('a@x.com')
    expect(db.select().from(schema.sourceIdentity).all()).toHaveLength(2)
  })

  it('preserves is_member / is_hidden / custom_name across a re-sync (upsert, not wipe)', async () => {
    const { db, schema, eq, reconcile, setMember, setHidden, setDisplayName } = await ctx()
    const p = db.select().from(schema.person).where(eq(schema.person.matchKey, 'a@x.com')).get()!
    setMember(db, p.id, true)
    setHidden(db, p.id, true)
    setDisplayName(db, p.id, 'Custom Al')

    reconcile(db, ALICE, ALL) // a normal daily sync with the same users

    const after = db.select().from(schema.person).where(eq(schema.person.matchKey, 'a@x.com')).get()!
    expect(after.id).toBe(p.id) // same row preserved — no churn
    expect(after.isMember).toBe(1)
    expect(after.isHidden).toBe(1)
    expect(after.customName).toBe('Custom Al')
    expect(after.displayName).toBe('Al') // source-derived name still refreshed
  })

  it('deletes a person + identities that vanish from an authoritative source', async () => {
    const { db, schema, reconcile } = await ctx()
    reconcile(db, [...ALICE, seerr('2', 'gone@x.com')], ALL)
    expect(db.select().from(schema.person).all().some(p => p.matchKey === 'gone@x.com')).toBe(true)

    reconcile(db, ALICE, ALL) // next sync no longer includes that user
    expect(db.select().from(schema.person).all().some(p => p.matchKey === 'gone@x.com')).toBe(false)
  })

  it('setDisplayName(null) clears the override, reverting to the derived name', async () => {
    const { db, schema, eq, setDisplayName } = await ctx()
    const p = db.select().from(schema.person).where(eq(schema.person.matchKey, 'a@x.com')).get()!
    setDisplayName(db, p.id, null)
    const after = db.select().from(schema.person).where(eq(schema.person.id, p.id)).get()!
    expect(after.customName).toBeNull()
  })

  it('fetch-guard: a failed source keeps its identities (not authoritative this run)', async () => {
    const { db, schema, reconcile } = await ctx()
    reconcile(db, [...ALICE, seerr('9', 's@x.com'), taut('19', 't@x.com')], ALL)
    // A run where Seerr failed: only tautulli is authoritative, raws carry only tautulli users.
    reconcile(db, [taut('11', 'a@x.com', { friendlyName: 'Al' }), taut('19', 't@x.com')], new Set(['tautulli'] as const))
    const seerrIds = db.select().from(schema.sourceIdentity).all().filter(i => i.source === 'seerr')
    expect(seerrIds.length).toBeGreaterThan(0) // s@x.com preserved despite absence from the partial pull
  })

  it('no authoritative source is a no-op', async () => {
    const { db, schema, reconcile } = await ctx()
    const before = db.select().from(schema.person).all().length
    reconcile(db, [], new Set())
    expect(db.select().from(schema.person).all().length).toBe(before)
  })

  it('an email change reallocates the person (accepted ADR-0007 edge)', async () => {
    const { db, schema, reconcile } = await ctx()
    reconcile(db, [...ALICE, seerr('30', 'old@x.com')], ALL)
    expect(db.select().from(schema.person).all().some(p => p.matchKey === 'old@x.com')).toBe(true)

    reconcile(db, [...ALICE, seerr('30', 'new@x.com')], ALL)
    const keys = db.select().from(schema.person).all().map(p => p.matchKey)
    expect(keys).not.toContain('old@x.com')
    expect(keys).toContain('new@x.com')
  })
})
