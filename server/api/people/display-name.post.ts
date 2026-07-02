import { getDb } from '../../db/client'
import { setDisplayName } from '../../people/register'

// Set or clear a Person's custom display-name override (ADR-0007). A non-empty name is stored as
// custom_name and shown in place of the source-derived name; an empty/absent name clears it, so the
// person falls back to the derived name. The override survives re-sync on the stable match_key.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ personId: number, displayName?: string | null }>(event)
  if (!Number.isInteger(body?.personId)) {
    setResponseStatus(event, 400)
    return { ok: false, message: 'personId is required' }
  }
  const name = typeof body.displayName === 'string' ? body.displayName : null
  setDisplayName(getDb(), body.personId, name)
  return { ok: true }
})
