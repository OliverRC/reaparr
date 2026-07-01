import { desc } from 'drizzle-orm'
import { getDb, schema } from '../../db/client'
import { isSyncRunning } from '../../sync/run'
import { isDemoMode } from '../../utils/seed'

export default defineEventHandler(() => {
  const db = getDb()
  const latest = db.select().from(schema.syncRun).orderBy(desc(schema.syncRun.id)).limit(1).get()
  const conns = db.select({
    source: schema.sourceConnection.source,
    enabled: schema.sourceConnection.enabled,
    lastStatus: schema.sourceConnection.lastStatus,
    lastError: schema.sourceConnection.lastError,
    lastSyncedAt: schema.sourceConnection.lastSyncedAt,
    hasUrl: schema.sourceConnection.baseUrl
  }).from(schema.sourceConnection).all()

  return {
    demoMode: isDemoMode(),
    running: isSyncRunning(),
    latest: latest
      ? {
          id: latest.id,
          status: latest.status,
          startedAt: latest.startedAt,
          finishedAt: latest.finishedAt,
          counts: latest.countsJson ? JSON.parse(latest.countsJson) : null,
          error: latest.error ? JSON.parse(latest.error) : null
        }
      : null,
    sources: conns.map(c => ({
      source: c.source,
      enabled: c.enabled === 1,
      configured: !!c.hasUrl,
      lastStatus: c.lastStatus,
      lastError: c.lastError,
      lastSyncedAt: c.lastSyncedAt
    }))
  }
})
