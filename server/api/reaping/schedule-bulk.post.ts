import { getDb } from '../../db/client'
import { scheduleTitle } from '../../reaping/operations'

// Bulk-schedule a selection of titles with the same grace. Body: { ids[], graceDays?, sendReminder?, actorPersonId? }.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ ids?: number[], graceDays?: number, sendReminder?: boolean, actorPersonId?: number }>(event)
  const ids = Array.isArray(body?.ids) ? body!.ids.filter(n => Number.isInteger(n)) : []
  if (ids.length === 0) {
    setResponseStatus(event, 400)
    return { ok: false, message: 'ids[] is required' }
  }
  const db = getDb()
  const scheduled: number[] = []
  const skipped: { id: number, message: string }[] = []
  for (const id of ids) {
    try {
      await scheduleTitle(db, id, {
        graceDays: body?.graceDays, sendReminder: body?.sendReminder, actorPersonId: body?.actorPersonId ?? null
      })
      scheduled.push(id)
    } catch (err) {
      skipped.push({ id, message: (err as Error).message })
    }
  }
  return { ok: true, scheduled, skipped }
})
