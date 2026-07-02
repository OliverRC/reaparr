import { eq } from 'drizzle-orm'
import { getDb, schema } from '../../../db/client'
import { raiseAppeal, withdrawAppeal } from '../../../reaping/operations'

// Raise or withdraw an appeal. Body: { personId, withdraw? }. In M1 the operator records the appeal
// on a member's behalf, so personId (the appellant) is required to raise. Withdraw returns to scheduled.
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    setResponseStatus(event, 400)
    return { ok: false, message: 'Invalid id' }
  }
  const body = await readBody<{ personId?: number, withdraw?: boolean }>(event)
  const db = getDb()
  const t = db.select({ id: schema.title.id }).from(schema.title).where(eq(schema.title.id, id)).get()
  if (!t) {
    setResponseStatus(event, 404)
    return { ok: false, message: 'Not found' }
  }
  try {
    if (body?.withdraw) {
      withdrawAppeal(db, id, body?.personId ?? null)
      return { ok: true, state: 'scheduled' }
    }
    if (body?.personId == null) {
      setResponseStatus(event, 400)
      return { ok: false, message: 'personId (the appellant) is required' }
    }
    raiseAppeal(db, id, body.personId)
    return { ok: true, state: 'appealed' }
  } catch (err) {
    setResponseStatus(event, 409)
    return { ok: false, message: (err as Error).message }
  }
})
