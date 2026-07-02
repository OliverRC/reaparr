import { eq } from 'drizzle-orm'
import { getDb, schema } from '../../../db/client'
import { extendClock } from '../../../reaping/operations'

// Extend / shorten a running clock. Body: { dueAt } (ISO) or { graceDays } (from scheduledAt).
// Only valid while scheduled or appealed. Not a state change.
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    setResponseStatus(event, 400)
    return { ok: false, message: 'Invalid id' }
  }
  const body = await readBody<{ dueAt?: string, graceDays?: number }>(event)
  const db = getDb()
  const t = db.select().from(schema.title).where(eq(schema.title.id, id)).get()
  if (!t) {
    setResponseStatus(event, 404)
    return { ok: false, message: 'Not found' }
  }
  if (t.state !== 'scheduled' && t.state !== 'appealed') {
    setResponseStatus(event, 409)
    return { ok: false, message: `Cannot extend a ${t.state} title` }
  }
  let dueAt = body?.dueAt
  if (!dueAt && body?.graceDays && t.scheduledAt) {
    dueAt = new Date(Date.parse(t.scheduledAt) + Math.round(body.graceDays) * 86_400_000).toISOString()
  }
  if (!dueAt) {
    setResponseStatus(event, 400)
    return { ok: false, message: 'Provide dueAt or graceDays' }
  }
  extendClock(db, id, dueAt)
  return { ok: true, dueAt }
})
