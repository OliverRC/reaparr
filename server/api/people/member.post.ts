import { getDb } from '../../db/client'
import { setMember } from '../../people/register'

// Mark/unmark a Person as an active member of the server. Members are the audience for reap
// notifications (delivery is a future feature). Membership rides on the person's stable match_key
// across re-sync (see ../people/register reconcile).
export default defineEventHandler(async (event) => {
  const body = await readBody<{ personId: number, isMember: boolean }>(event)
  if (!Number.isInteger(body?.personId)) {
    setResponseStatus(event, 400)
    return { ok: false, message: 'personId is required' }
  }
  setMember(getDb(), body.personId, !!body.isMember)
  return { ok: true, isMember: !!body.isMember }
})
