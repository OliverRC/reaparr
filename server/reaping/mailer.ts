// Email transport behind the Notifier seam (docs/adr/0004, KTD-6). Default is SMTP via nodemailer
// when configured; otherwise a log-only fallback so the workflow never blocks on mail (email is
// non-load-bearing). Transport choice is intentionally deferred (plan OQ-1) — swap here, not in
// callers. nodemailer is resolved lazily via a computed specifier so a missing dep degrades to log
// rather than failing the build.

import type { getDb } from '../db/client'
import { schema } from '../db/client'

type Db = ReturnType<typeof getDb>

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
    // Computed specifier so a missing optional dep does not break typecheck/build.
    const spec = ['node', 'mailer'].join('')
    const nodemailer = await import(/* @vite-ignore */ spec) as {
      createTransport: (opts: unknown) => { sendMail: (m: unknown) => Promise<unknown> }
    }
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined
    })
    await transport.sendMail({ from: cfg.from, to: msg.to, subject: msg.subject, text: msg.body })
    return { ok: true, transport: 'smtp' }
  } catch (err) {
    return { ok: false, transport: 'smtp', error: (err as Error).message }
  }
}
