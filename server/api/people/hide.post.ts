import { eq } from 'drizzle-orm'
import { getDb, schema } from '../../db/client'

// Hide/unhide a Person — hidden people drop to the collapsed bottom section of the
// People page so they stay out of the way. Follows identities across re-sync.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ personId: number, isHidden: boolean }>(event)
  if (!Number.isInteger(body?.personId)) {
    setResponseStatus(event, 400)
    return { ok: false, message: 'personId is required' }
  }
  const db = getDb()
  db.update(schema.person)
    .set({ isHidden: body.isHidden ? 1 : 0 })
    .where(eq(schema.person.id, body.personId))
    .run()
  return { ok: true, isHidden: !!body.isHidden }
})
