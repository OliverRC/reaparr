import { eq } from 'drizzle-orm'
import { getDb, schema } from '../../db/client'

// Mark/unmark a Person as an active member of the server. Members are the audience
// for reap notifications (delivery is a future feature). Membership follows the
// person's identities across re-sync (see persistPeople).
export default defineEventHandler(async (event) => {
  const body = await readBody<{ personId: number, isMember: boolean }>(event)
  if (!Number.isInteger(body?.personId)) {
    setResponseStatus(event, 400)
    return { ok: false, message: 'personId is required' }
  }
  const db = getDb()
  db.update(schema.person)
    .set({ isMember: body.isMember ? 1 : 0 })
    .where(eq(schema.person.id, body.personId))
    .run()
  return { ok: true, isMember: !!body.isMember }
})
