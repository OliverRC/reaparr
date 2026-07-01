import { eq } from 'drizzle-orm'
import { getDb, schema } from '../../../../db/client'
import { ALL_SOURCES, createClient, type Source } from '../../../../sources'

// FR-17a: run the source's probe and report pass/fail with reason. Uses a
// credential from the request body if provided (test-before-save), else the stored one.
export default defineEventHandler(async (event) => {
  const source = getRouterParam(event, 'source') as Source
  if (!ALL_SOURCES.includes(source)) {
    setResponseStatus(event, 400)
    return { ok: false, message: `Unknown source: ${source}` }
  }
  const body = await readBody<{ baseUrl?: string, credential?: string }>(event)
    .catch(() => ({} as { baseUrl?: string, credential?: string }))
  const db = getDb()
  const row = db.select().from(schema.sourceConnection).where(eq(schema.sourceConnection.source, source)).get()

  const baseUrl = (body?.baseUrl?.trim()) || row?.baseUrl || ''
  const credential = (body?.credential && body.credential.length > 0) ? body.credential : (row?.credential || '')

  if (!baseUrl || !credential) {
    return { ok: false, message: 'Base URL and credential are required' }
  }

  const client = createClient(source, { baseUrl, credential })
  const result = await client.probe()

  db.update(schema.sourceConnection).set({
    lastTestedAt: new Date().toISOString(),
    lastStatus: result.ok ? 'ok' : 'error',
    lastError: result.ok ? null : result.message
  }).where(eq(schema.sourceConnection.source, source)).run()

  return result
})
