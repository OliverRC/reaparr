import { eq } from 'drizzle-orm'
import { getDb, schema } from '../../../db/client'

// Spare ("keep forever") / return-to-the-reap a title. Spared titles are pinned to
// the bottom of the dashboard with their score hidden, and excluded from the
// reclaimable figure. The flag survives re-syncs (see persistTitles).
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    setResponseStatus(event, 400)
    return { ok: false, message: 'Invalid id' }
  }
  const body = await readBody<{ spared: boolean }>(event)
  const spared = !!body?.spared

  const db = getDb()
  const t = db.select({ id: schema.title.id }).from(schema.title).where(eq(schema.title.id, id)).get()
  if (!t) {
    setResponseStatus(event, 404)
    return { ok: false, message: 'Not found' }
  }

  db.update(schema.title)
    .set({ spared: spared ? 1 : 0, sparedAt: spared ? new Date().toISOString() : null })
    .where(eq(schema.title.id, id))
    .run()

  return { ok: true, spared }
})
