import { eq, inArray } from 'drizzle-orm'
import { getDb, schema } from '../../db/client'

// Split selected SourceIdentities off a Person into a new canonical Person.
// Both the source and the new Person are marked 'confirmed' (a manual override).
export default defineEventHandler(async (event) => {
  const body = await readBody<{ personId: number, identityIds: number[], displayName?: string }>(event)
  const identityIds = (body?.identityIds ?? []).filter(n => Number.isInteger(n))
  if (!Number.isInteger(body?.personId) || identityIds.length === 0) {
    setResponseStatus(event, 400)
    return { ok: false, message: 'personId and at least one identityId are required' }
  }
  const db = getDb()

  const moving = db.select().from(schema.sourceIdentity).where(inArray(schema.sourceIdentity.id, identityIds)).all()
  if (moving.length === 0) return { ok: false, message: 'No matching identities' }

  const name = body.displayName?.trim()
    || moving.find(i => i.source === 'tautulli' && i.friendlyName)?.friendlyName
    || moving[0]!.username
    || moving[0]!.email?.split('@')[0]
    || 'Person'
  const ins = db.insert(schema.person).values({ displayName: name, matchStatus: 'confirmed' }).run()
  const newId = Number(ins.lastInsertRowid)

  db.update(schema.sourceIdentity).set({ personId: newId }).where(inArray(schema.sourceIdentity.id, identityIds)).run()
  db.update(schema.person).set({ matchStatus: 'confirmed' }).where(eq(schema.person.id, body.personId)).run()

  return { ok: true, newPersonId: newId }
})
