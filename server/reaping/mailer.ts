// Email transport behind the Notifier seam (docs/adr/0004, KTD-6). SMTP via nodemailer when
// configured; otherwise a log-only fallback so the workflow never blocks on mail (email is
// non-load-bearing). The send is inline but bounded by connection/greeting/socket timeouts, so a
// dead SMTP server can't hang the sync or an API request. nodemailer is imported lazily so the log
// path never loads it.

import { eq } from 'drizzle-orm'
import type { getDb } from '../db/client'
import { schema } from '../db/client'

type Db = ReturnType<typeof getDb>

// Bound every phase of the SMTP conversation so an unreachable/slow server fails fast (~10s worst
// case) rather than stalling the request/sync that triggered the send.
const SMTP_TIMEOUT_MS = 10_000

export interface MailMessage {
  to: string
  subject: string
  body: string
}

export interface MailResult {
  ok: boolean
  transport: 'smtp' | 'log'
  error?: string
  // Set when a dev catch-all redirected this message away from its intended recipient.
  redirectedFrom?: string
}

// Dev catch-all guard: in dev or demo mode, if a dev address is configured (env REAPARR_DEV_MAIL_TO,
// or app_setting dev_mail_to), EVERY outgoing email is redirected to it so a developer can never spam
// real members. A true production build (NODE_ENV=production and not demo) never redirects, so a
// leaked setting can't swallow real mail. Returns the catch-all address, or null when none applies.
function devRedirectTarget(db: Db): string | null {
  const isDemo = process.env.REAPARR_DEMO === '1' || process.env.REAPARR_DEMO === 'true'
  if (process.env.NODE_ENV === 'production' && !isDemo) return null
  if (process.env.REAPARR_DEV_MAIL_TO) return process.env.REAPARR_DEV_MAIL_TO
  return db.select({ value: schema.appSetting.value }).from(schema.appSetting)
    .where(eq(schema.appSetting.key, 'dev_mail_to')).get()?.value ?? null
}

interface SmtpConfig {
  host: string
  port: number
  user?: string
  pass?: string
  from: string
}

function readSmtpConfig(db: Db): SmtpConfig | null {
  const rows = db.select().from(schema.appSetting).all()
  const map = new Map(rows.map(r => [r.key, r.value]))
  const get = (k: string) => map.get(k) ?? process.env[k.toUpperCase()]
  const host = get('smtp_host')
  const from = get('smtp_from')
  if (!host || !from) return null
  const port = Number(get('smtp_port') ?? 587)
  return { host, port: Number.isFinite(port) ? port : 587, user: get('smtp_user'), pass: get('smtp_pass'), from }
}

export async function sendMail(db: Db, msg: MailMessage): Promise<MailResult> {
  // Dev catch-all: redirect the whole message to the dev address, keeping the intended recipient
  // visible in the body (and the result) so nothing real is spammed while developing.
  const redirect = devRedirectTarget(db)
  const to = redirect ?? msg.to
  const body = redirect ? `[dev redirect — intended for ${msg.to}]\n\n${msg.body}` : msg.body
  const extra = redirect ? { redirectedFrom: msg.to } : {}

  const cfg = readSmtpConfig(db)
  if (!cfg) {
    // Fallback: record the intent to the log. Keeps the workflow moving with no transport configured.
    const suffix = redirect ? ` (dev redirect from ${msg.to})` : ''
    console.log(`[reaping mail:log] to=${to} subject=${JSON.stringify(msg.subject)}${suffix}`)
    return { ok: true, transport: 'log', ...extra }
  }
  try {
    const { createTransport } = await import('nodemailer')
    const transport = createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS
    })
    await transport.sendMail({ from: cfg.from, to, subject: msg.subject, text: body })
    return { ok: true, transport: 'smtp', ...extra }
  } catch (err) {
    return { ok: false, transport: 'smtp', error: (err as Error).message, ...extra }
  }
}
