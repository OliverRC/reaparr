import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.REAPARR_DB_PATH = join(mkdtempSync(join(tmpdir(), 'reaparr-devmail-')), 'test.db')
delete process.env.REAPARR_DEV_MAIL_TO // ensure the app_setting path is what's exercised

async function ctx() {
  const { getDb, schema } = await import('../../server/db/client')
  const { eq } = await import('drizzle-orm')
  return { db: getDb(), schema, eq }
}
async function setDevMailTo(value: string | null) {
  const { db, schema, eq } = await ctx()
  if (value == null) {
    db.delete(schema.appSetting).where(eq(schema.appSetting.key, 'dev_mail_to')).run()
  } else {
    db.insert(schema.appSetting).values({ key: 'dev_mail_to', value })
      .onConflictDoUpdate({ target: schema.appSetting.key, set: { value } }).run()
  }
}

beforeEach(async () => {
  await setDevMailTo(null)
})

describe('dev mail redirect (anti-spam guard)', () => {
  it('redirects every message to the configured dev address, preserving the intended recipient', async () => {
    await setDevMailTo('me@dev.test')
    const { sendMail } = await import('../../server/reaping/mailer')
    const { db } = await ctx()
    const res = await sendMail(db, { to: 'real.member@example.com', subject: 'CONCERNING X', body: 'IT IS DUE.' })
    expect(res.ok).toBe(true)
    expect(res.redirectedFrom).toBe('real.member@example.com') // intended recipient preserved
  })

  it('does not redirect when no dev address is configured', async () => {
    const { sendMail } = await import('../../server/reaping/mailer')
    const { db } = await ctx()
    const res = await sendMail(db, { to: 'real.member@example.com', subject: 'CONCERNING X', body: 'IT IS DUE.' })
    expect(res.redirectedFrom).toBeUndefined()
  })

  it('never redirects in a true production build, even when a dev address leaks into settings', async () => {
    await setDevMailTo('me@dev.test')
    const prevEnv = process.env.NODE_ENV
    const prevDemo = process.env.REAPARR_DEMO
    process.env.NODE_ENV = 'production'
    delete process.env.REAPARR_DEMO
    try {
      const { sendMail } = await import('../../server/reaping/mailer')
      const { db } = await ctx()
      const res = await sendMail(db, { to: 'real.member@example.com', subject: 'CONCERNING X', body: 'IT IS DUE.' })
      expect(res.redirectedFrom).toBeUndefined()
    } finally {
      process.env.NODE_ENV = prevEnv
      if (prevDemo == null) delete process.env.REAPARR_DEMO
      else process.env.REAPARR_DEMO = prevDemo
    }
  })

  it('still redirects in a demo build (NODE_ENV=production but REAPARR_DEMO=1)', async () => {
    await setDevMailTo('me@dev.test')
    const prevEnv = process.env.NODE_ENV
    const prevDemo = process.env.REAPARR_DEMO
    process.env.NODE_ENV = 'production'
    process.env.REAPARR_DEMO = '1'
    try {
      const { sendMail } = await import('../../server/reaping/mailer')
      const { db } = await ctx()
      const res = await sendMail(db, { to: 'real.member@example.com', subject: 'CONCERNING X', body: 'IT IS DUE.' })
      expect(res.redirectedFrom).toBe('real.member@example.com')
    } finally {
      process.env.NODE_ENV = prevEnv
      if (prevDemo == null) delete process.env.REAPARR_DEMO
      else process.env.REAPARR_DEMO = prevDemo
    }
  })
})
