import { eq } from 'drizzle-orm'
import { getDb, schema } from '../../../db/client'
import { sendMail } from '../../../reaping/mailer'

// Send a test email to verify SMTP config. Sends regardless of the notifications toggle (it's an
// explicit probe). Defaults the recipient to the configured 'from' address if none is given.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ to?: string }>(event)
  const db = getDb()
  const from = db.select({ value: schema.appSetting.value }).from(schema.appSetting)
    .where(eq(schema.appSetting.key, 'smtp_from')).get()?.value
  const to = body?.to?.trim() || from
  if (!to) {
    setResponseStatus(event, 400)
    return { ok: false, message: 'No recipient — set a From address or provide one.' }
  }
  const result = await sendMail(db, {
    to,
    subject: 'CONCERNING A TEST',
    body: 'THIS IS A TEST. IF YOU READ IT, THE SANDS CAN SPEAK.'
  })
  if (!result.ok) setResponseStatus(event, 502)
  return { ok: result.ok, transport: result.transport, to, ...(result.error ? { message: result.error } : {}) }
})
