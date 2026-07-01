import { eq } from 'drizzle-orm'
import { getDb, schema } from '../../db/client'
import { ALL_SOURCES, type Source } from '../../sources'

interface ConnUpdate {
  source: Source
  baseUrl?: string
  credential?: string // write-only; only applied when a non-empty value is sent
  enabled?: boolean
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ connections?: ConnUpdate[] } | ConnUpdate[]>(event)
  const updates = Array.isArray(body) ? body : (body?.connections ?? [])
  const db = getDb()

  for (const u of updates) {
    if (!ALL_SOURCES.includes(u.source)) continue
    const set: Record<string, unknown> = {}
    if (u.baseUrl !== undefined) set.baseUrl = u.baseUrl.trim() || null
    if (typeof u.enabled === 'boolean') set.enabled = u.enabled ? 1 : 0
    // Only overwrite the credential when a fresh non-empty one is provided.
    if (typeof u.credential === 'string' && u.credential.length > 0) {
      set.credential = u.credential
    }
    if (Object.keys(set).length === 0) continue
    set.lastStatus = 'untested'
    db.update(schema.sourceConnection).set(set).where(eq(schema.sourceConnection.source, u.source)).run()
  }

  return { ok: true }
})
