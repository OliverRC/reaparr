import { eq } from 'drizzle-orm'
import { getDb, schema } from '../../../db/client'
import { cancelSchedule } from '../../../reaping/operations'

// Cancel a reaping ({scheduled|appealed|due} → eligible). Body: { actorPersonId? }.
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
    cancelSchedule(db, id, body?.actorPersonId ?? null)
    return { ok: true, state: 'eligible' }
  } catch (err) {
    setResponseStatus(event, 409)
    return { ok: false, message: (err as Error).message }
  }
})
