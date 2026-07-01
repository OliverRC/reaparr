import { and, eq, inArray } from 'drizzle-orm'
import { getDb, schema } from '../../db/client'

// Merge several people into one canonical Person. Re-attributes their requests +
// watcher rows, marks the survivor 'confirmed' so a re-sync won't re-split them.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ personIds: number[], targetId?: number }>(event)
  const ids = [...new Set((body?.personIds ?? []).filter(n => Number.isInteger(n)))]
  if (ids.length < 2) {
    setResponseStatus(event, 400)
    return { ok: false, message: 'Provide at least two personIds to merge' }
  }
  const target = body?.targetId && ids.includes(body.targetId) ? body.targetId : ids[0]!
  const others = ids.filter(id => id !== target)
  const db = getDb()

  // Re-point identities and request attributions.
  db.update(schema.sourceIdentity).set({ personId: target }).where(inArray(schema.sourceIdentity.personId, others)).run()
  db.update(schema.request).set({ requestedByPersonId: target }).where(inArray(schema.request.requestedByPersonId, others)).run()

  // Move watcher rows, respecting the (title_id, person_id) composite PK.
  const moving = db.select().from(schema.titleWatcher).where(inArray(schema.titleWatcher.personId, others)).all()
  for (const w of moving) {
    const existing = db.select().from(schema.titleWatcher)
      .where(and(eq(schema.titleWatcher.titleId, w.titleId), eq(schema.titleWatcher.personId, target))).get()
    if (existing) {
      const later = maxIso(existing.lastWatchedAt, w.lastWatchedAt)
      db.update(schema.titleWatcher).set({ lastWatchedAt: later })
        .where(and(eq(schema.titleWatcher.titleId, w.titleId), eq(schema.titleWatcher.personId, target))).run()
      db.delete(schema.titleWatcher)
        .where(and(eq(schema.titleWatcher.titleId, w.titleId), eq(schema.titleWatcher.personId, w.personId))).run()
    } else {
      db.update(schema.titleWatcher).set({ personId: target })
        .where(and(eq(schema.titleWatcher.titleId, w.titleId), eq(schema.titleWatcher.personId, w.personId))).run()
    }
  }

  db.update(schema.person).set({ matchStatus: 'confirmed' }).where(eq(schema.person.id, target)).run()
  db.delete(schema.person).where(inArray(schema.person.id, others)).run()

  return { ok: true, targetId: target }
})

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return Date.parse(a) >= Date.parse(b) ? a : b
}
