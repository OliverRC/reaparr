import { getDb, schema } from '../../db/client'

// The only two knobs (spec §8.5): staleness tiers + grace days. No rule authoring.
const KEYS: Record<string, string> = {
  graceDays: 'grace_days',
  staleT1: 'stale_t1',
  staleT2: 'stale_t2',
  staleT3: 'stale_t3'
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, number>>(event)
  const db = getDb()
  for (const [field, key] of Object.entries(KEYS)) {
    const v = body?.[field]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      db.insert(schema.appSetting).values({ key, value: String(Math.round(v)) })
        .onConflictDoUpdate({ target: schema.appSetting.key, set: { value: String(Math.round(v)) } }).run()
    }
  }
  return { ok: true }
})
