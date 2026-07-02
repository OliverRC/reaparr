import { eq } from 'drizzle-orm'
import { getDb, schema } from '../../../db/client'
import { resolveAppeal } from '../../../reaping/operations'

// Resolve an appeal. Body: { decision: 'grant' | 'deny', actorPersonId? }.
// grant → reprieve (eligible, notify reprieved); deny → scheduled (clock continues).
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    setResponseStatus(event, 400)
    return { ok: false, message: 'Invalid id' }
  }
  const body = await readBody<{ decision?: 'grant' | 'deny', actorPersonId?: number }>(event)
  if (body?.decision !== 'grant' && body?.decision !== 'deny') {
    setResponseStatus(event, 400)
    return { ok: false, message: 'decision must be \'grant\' or \'deny\'' }
  }
  const db = getDb()
  const t = db.select({ id: schema.title.id }).from(schema.title).where(eq(schema.title.id, id)).get()
  if (!t) {
    setResponseStatus(event, 404)
    return { ok: false, message: 'Not found' }
  }
  try {
    await resolveAppeal(db, id, body.decision, body?.actorPersonId ?? null)
    return { ok: true, state: body.decision === 'grant' ? 'eligible' : 'scheduled' }
  } catch (err) {
    setResponseStatus(event, 409)
    return { ok: false, message: (err as Error).message }
  }
})
