import { getDb, schema } from '../../db/client'

// People roster for the People page. Each person is a canonical human resolved by email (ADR-0007):
// displayName is the admin's custom_name if set, else the source-derived name. customName is returned
// raw so the edit control can prefill / clear it.
export default defineEventHandler(() => {
  const db = getDb()
  const persons = db.select().from(schema.person).all()
  const identities = db.select().from(schema.sourceIdentity).all()
  const idsByPerson = new Map<number, typeof identities>()
  for (const i of identities) {
    if (i.personId == null) continue
    const arr = idsByPerson.get(i.personId) ?? []
    arr.push(i)
    idsByPerson.set(i.personId, arr)
  }

  // Watch / request footprint counts per person (decision-relevant context).
  const requests = db.select().from(schema.request).all()
  const watchers = db.select().from(schema.titleWatcher).all()
  const reqCount = new Map<number, number>()
  for (const r of requests) if (r.requestedByPersonId != null) reqCount.set(r.requestedByPersonId, (reqCount.get(r.requestedByPersonId) ?? 0) + 1)
  const watchCount = new Map<number, number>()
  for (const w of watchers) watchCount.set(w.personId, (watchCount.get(w.personId) ?? 0) + 1)

  const people = persons.map(p => ({
    id: p.id,
    displayName: p.customName ?? p.displayName,
    customName: p.customName,
    isMember: p.isMember === 1,
    isHidden: p.isHidden === 1,
    requestCount: reqCount.get(p.id) ?? 0,
    watchedTitles: watchCount.get(p.id) ?? 0,
    identities: (idsByPerson.get(p.id) ?? []).map(i => ({
      id: i.id,
      source: i.source,
      sourceUserId: i.sourceUserId,
      username: i.username,
      email: i.email,
      friendlyName: i.friendlyName
    }))
  })).sort((a, b) => a.displayName.localeCompare(b.displayName))

  return {
    memberCount: people.filter(p => p.isMember && !p.isHidden).length,
    hiddenCount: people.filter(p => p.isHidden).length,
    total: people.length,
    people
  }
})
