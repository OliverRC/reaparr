import { getDb, schema } from '../../db/client'

// Notification settings: the global on/off plus SMTP config. The password is write-only — we return
// only whether one is set, never the value (mirrors how source credentials are handled).
export default defineEventHandler(() => {
  const db = getDb()
  const map = new Map(db.select().from(schema.appSetting).all().map(r => [r.key, r.value]))
  const enabledRaw = map.get('notifications_enabled')
  return {
    enabled: enabledRaw !== '0' && enabledRaw !== 'false', // default on
    smtpHost: map.get('smtp_host') ?? '',
    smtpPort: map.get('smtp_port') ? Number(map.get('smtp_port')) : 587,
    smtpUser: map.get('smtp_user') ?? '',
    smtpFrom: map.get('smtp_from') ?? '',
    smtpPassSet: !!map.get('smtp_pass')
  }
})
