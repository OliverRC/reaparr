// Email transport behind the Notifier seam (docs/adr/0004, KTD-6). SMTP via nodemailer when
// configured; otherwise a log-only fallback so the workflow never blocks on mail (email is
// non-load-bearing). The send is inline but bounded by connection/greeting/socket timeouts, so a
// dead SMTP server can't hang the sync or an API request. nodemailer is imported lazily so the log
// path never loads it.

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
  const cfg = readSmtpConfig(db)
  if (!cfg) {
    // Fallback: record the intent to the log. Keeps the workflow moving with no transport configured.
    console.log(`[reaping mail:log] to=${msg.to} subject=${JSON.stringify(msg.subject)}`)
    return { ok: true, transport: 'log' }
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
    await transport.sendMail({ from: cfg.from, to: msg.to, subject: msg.subject, text: msg.body })
    return { ok: true, transport: 'smtp' }
  } catch (err) {
    return { ok: false, transport: 'smtp', error: (err as Error).message }
  }
}
