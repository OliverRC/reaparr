import { eq } from 'drizzle-orm'
import { getDb, schema } from '../../../db/client'
import { scheduleTitle } from '../../../reaping/operations'

// Schedule a title for reaping (eligible → scheduled). Body: { graceDays?, sendReminder?, actorPersonId? }.
// M1 has no session, so actorPersonId is optional (falls back to a system actor).
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    setResponseStatus(event, 400)
    return { ok: false, message: 'Invalid id' }
  }
  const body = await readBody<{ graceDays?: number, sendReminder?: boolean, actorPersonId?: number }>(event)
  const db = getDb()
  const t = db.select({ id: schema.title.id }).from(schema.title).where(eq(schema.title.id, id)).get()
  if (!t) {
    setResponseStatus(event, 404)
    return { ok: false, message: 'Not found' }
  }
  try {
    const res = await scheduleTitle(db, id, {
      graceDays: body?.graceDays, sendReminder: body?.sendReminder, actorPersonId: body?.actorPersonId ?? null
    })
    return { ok: true, state: 'scheduled', dueAt: res.dueAt, graceDays: res.graceDays }
  } catch (err) {
    setResponseStatus(event, 409)
    return { ok: false, message: (err as Error).message }
  }
})
