import { eq } from 'drizzle-orm'
import { getDb, schema } from '../../db/client'

// Confirm a Person's mapping (clears the needs_review flag, locks it against re-sync churn).
export default defineEventHandler(async (event) => {
  const body = await readBody<{ personId: number, displayName?: string }>(event)
  if (!Number.isInteger(body?.personId)) {
    setResponseStatus(event, 400)
    return { ok: false, message: 'personId is required' }
  }
  const db = getDb()
  const set: Record<string, unknown> = { matchStatus: 'confirmed' }
  if (body.displayName?.trim()) set.displayName = body.displayName.trim()
  db.update(schema.person).set(set).where(eq(schema.person.id, body.personId)).run()
  return { ok: true }
})
