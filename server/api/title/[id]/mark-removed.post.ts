import { eq } from 'drizzle-orm'
import { getDb, schema } from '../../../db/client'
import { markRemoved } from '../../../reaping/operations'

// Mark a due title as removed (due → removed) after the operator actioned removal in Sonarr/Radarr.
// Optimistic; the next sync confirms. Fires the `departed` notification. Body: { actorPersonId? }.
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    setResponseStatus(event, 400)
    return { ok: false, message: 'Invalid id' }
  }
  const body = await readBody<{ actorPersonId?: number }>(event)
  const db = getDb()
  const t = db.select({ id: schema.title.id }).from(schema.title).where(eq(schema.title.id, id)).get()
  if (!t) {
    setResponseStatus(event, 404)
    return { ok: false, message: 'Not found' }
  }
  try {
    await markRemoved(db, id, body?.actorPersonId ?? null)
    return { ok: true, state: 'removed' }
  } catch (err) {
    setResponseStatus(event, 409)
    return { ok: false, message: (err as Error).message }
  }
})
