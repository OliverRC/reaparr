import { getDb, schema } from '../../db/client'

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
    displayName: p.displayName,
    matchStatus: p.matchStatus,
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
  })).sort((a, b) => {
    const order = (s: string) => (s === 'needs_review' ? 0 : s === 'auto' ? 1 : 2)
    return order(a.matchStatus) - order(b.matchStatus) || a.displayName.localeCompare(b.displayName)
  })

  return {
    needsReview: people.filter(p => p.matchStatus === 'needs_review' && !p.isHidden).length,
    memberCount: people.filter(p => p.isMember && !p.isHidden).length,
    hiddenCount: people.filter(p => p.isHidden).length,
    total: people.length,
    people
  }
})
