import { getDb, schema } from '../../db/client'
import { DEFAULT_SCORING } from '../../sync/score'

export default defineEventHandler(() => {
  const db = getDb()
  const rows = db.select().from(schema.appSetting).all()
  const map = new Map(rows.map(r => [r.key, r.value]))
  const num = (k: string, d: number) => {
    const v = map.get(k)
    const n = v != null ? Number(v) : NaN
    return Number.isFinite(n) ? n : d
  }
  return {
    graceDays: num('grace_days', DEFAULT_SCORING.graceDays),
    staleT1: num('stale_t1', DEFAULT_SCORING.staleT1),
    staleT2: num('stale_t2', DEFAULT_SCORING.staleT2),
    staleT3: num('stale_t3', DEFAULT_SCORING.staleT3),
    defaults: DEFAULT_SCORING
  }
})
