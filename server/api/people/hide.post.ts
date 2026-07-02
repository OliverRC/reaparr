import { getDb } from '../../db/client'
import { setHidden } from '../../people/register'

// Hide/unhide a Person — hidden people drop to the collapsed bottom section of the People page so
// they stay out of the way. The flag rides on the person's stable match_key across re-sync.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ personId: number, isHidden: boolean }>(event)
  if (!Number.isInteger(body?.personId)) {
    setResponseStatus(event, 400)
    return { ok: false, message: 'personId is required' }
  }
  setHidden(getDb(), body.personId, !!body.isHidden)
  return { ok: true, isHidden: !!body.isHidden }
})
