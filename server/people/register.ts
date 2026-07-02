// The person register — the deep module that owns person + source_identity (ADR-0007). Both the sync
// pipeline (persist.ts) and the people/* API handlers go through these intent verbs instead of
// hand-writing Drizzle, so the "manual overrides survive a re-sync" invariant lives in one place.
//
// reconcile is an upsert-by-match_key + delete-missing (never a wipe): persons are matched to
// identity clusters by their stable match_key, so is_member / is_hidden / custom_name — and any
// actor references from the reaping workflow — ride along on the preserved row. Every verb is atomic.

import { eq, sql } from 'drizzle-orm'
import type { getDb } from '../db/client'
import { schema } from '../db/client'
import { resolveIdentities, type IdentitySource, type RawIdentity } from '../sync/identity'

type Db = ReturnType<typeof getDb>

const idKey = (source: string, sourceUserId: string): string => `${source}:${sourceUserId}`

function personCount(db: Db): number {
  return db.select({ n: sql<number>`count(*)` }).from(schema.person).get()?.n ?? 0
}

/**
 * Reconcile the person register from freshly-fetched source identities. Groups by email (ADR-0007),
 * upserts persons by match_key, and deletes what genuinely vanished.
 *
 * Fetch-guard (docs/adr/0002): only `okSources` are authoritative this run. Identities from a source
 * that failed or is disabled are preserved untouched and still counted when clustering, so a transient
 * outage can't drop a person or split a cross-source cluster. `raws` MUST contain only identities from
 * `okSources`; the preserved identities are read back from the DB. With no authoritative source, the
 * register is left exactly as-is.
 *
 * Returns the resulting person count.
 */
export function reconcile(db: Db, raws: RawIdentity[], okSources: ReadonlySet<IdentitySource>): number {
  if (okSources.size === 0) return personCount(db)

  // better-sqlite3 is a single synchronous connection, so statements issued via the outer `db` inside
  // this callback run within the BEGIN/COMMIT drizzle opens — the whole verb is atomic.
  return db.transaction(() => {
    const existing = db.select().from(schema.sourceIdentity).all()

    // Identities from non-authoritative sources are preserved as-is, but still participate in
    // clustering so an email shared with an incoming identity keeps them in one person.
    const preserved: RawIdentity[] = existing
      .filter(i => !okSources.has(i.source as IdentitySource))
      .map(i => ({
        source: i.source as IdentitySource, sourceUserId: i.sourceUserId,
        username: i.username, email: i.email, friendlyName: i.friendlyName
      }))

    const groups = resolveIdentities([...preserved, ...raws])
    const desiredMatchKeys = new Set<string>()
    const incomingKeys = new Set(raws.map(r => idKey(r.source, r.sourceUserId)))

    for (const g of groups) {
      desiredMatchKeys.add(g.matchKey)

      // Upsert the person by match_key — preserve id + flags + custom_name, refresh the derived name.
      const existingPerson = db.select({ id: schema.person.id }).from(schema.person)
        .where(eq(schema.person.matchKey, g.matchKey)).get()
      let personId: number
      if (existingPerson) {
        db.update(schema.person).set({ displayName: g.displayName }).where(eq(schema.person.id, existingPerson.id)).run()
        personId = existingPerson.id
      } else {
        const r = db.insert(schema.person).values({ matchKey: g.matchKey, displayName: g.displayName }).run()
        personId = Number(r.lastInsertRowid)
      }

      // Upsert each identity by (source, source_user_id), pointing it at this person.
      for (const i of g.identities) {
        const vals = {
          personId, source: i.source, sourceUserId: i.sourceUserId,
          username: i.username ?? null, email: i.email ?? null, friendlyName: i.friendlyName ?? null
        }
        const ex = db.select({ id: schema.sourceIdentity.id }).from(schema.sourceIdentity)
          .where(sql`${schema.sourceIdentity.source} = ${i.source} and ${schema.sourceIdentity.sourceUserId} = ${i.sourceUserId}`)
          .get()
        if (ex) db.update(schema.sourceIdentity).set(vals).where(eq(schema.sourceIdentity.id, ex.id)).run()
        else db.insert(schema.sourceIdentity).values(vals).run()
      }
    }

    // Delete identities that vanished from an authoritative source this run (preserved sources untouched).
    for (const i of existing) {
      if (okSources.has(i.source as IdentitySource) && !incomingKeys.has(idKey(i.source, i.sourceUserId))) {
        db.delete(schema.sourceIdentity).where(eq(schema.sourceIdentity.id, i.id)).run()
      }
    }

    // Delete persons left with no identities (their match_key is no longer produced). FK references
    // from title_transition / reaping_notification / request null out; title_watcher cascades.
    const persons = db.select({ id: schema.person.id, matchKey: schema.person.matchKey }).from(schema.person).all()
    for (const p of persons) {
      if (!desiredMatchKeys.has(p.matchKey)) {
        db.delete(schema.person).where(eq(schema.person.id, p.id)).run()
      }
    }

    return personCount(db)
  })
}

/** Mark/unmark a person as an active member (the reap-notification audience). */
export function setMember(db: Db, personId: number, isMember: boolean): void {
  db.update(schema.person).set({ isMember: isMember ? 1 : 0 }).where(eq(schema.person.id, personId)).run()
}

/** Hide/unhide a person (drops them to the collapsed section of the People page). */
export function setHidden(db: Db, personId: number, isHidden: boolean): void {
  db.update(schema.person).set({ isHidden: isHidden ? 1 : 0 }).where(eq(schema.person.id, personId)).run()
}

/** Set (or clear, with null/empty) a person's custom display-name override. */
export function setDisplayName(db: Db, personId: number, name: string | null): void {
  const custom = name && name.trim() ? name.trim() : null
  db.update(schema.person).set({ customName: custom }).where(eq(schema.person.id, personId)).run()
}
