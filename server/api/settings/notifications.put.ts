import { getDb, schema } from '../../db/client'

interface Body {
  enabled?: boolean
  smtpHost?: string
  smtpPort?: number
  smtpUser?: string
  smtpPass?: string
  smtpFrom?: string
}

// Persist notification settings to app_setting. The password is only written when a non-empty value
// is supplied, so leaving the field blank preserves the stored one (write-only, like credentials).
export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  const db = getDb()
  const set = (key: string, value: string) => {
    db.insert(schema.appSetting).values({ key, value })
      .onConflictDoUpdate({ target: schema.appSetting.key, set: { value } }).run()
  }

  if (typeof body?.enabled === 'boolean') set('notifications_enabled', body.enabled ? '1' : '0')
  if (typeof body?.smtpHost === 'string') set('smtp_host', body.smtpHost.trim())
  if (typeof body?.smtpFrom === 'string') set('smtp_from', body.smtpFrom.trim())
  if (typeof body?.smtpUser === 'string') set('smtp_user', body.smtpUser.trim())
  if (typeof body?.smtpPort === 'number' && Number.isFinite(body.smtpPort)) set('smtp_port', String(Math.round(body.smtpPort)))
  if (typeof body?.smtpPass === 'string' && body.smtpPass.length > 0) set('smtp_pass', body.smtpPass)

  return { ok: true }
})
