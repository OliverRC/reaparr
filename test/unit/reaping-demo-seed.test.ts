import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.REAPARR_DB_PATH = join(mkdtempSync(join(tmpdir(), 'reaparr-demo-')), 'test.db')

async function ctx() {
  const { getDb, schema } = await import('../../server/db/client')
  const { eq } = await import('drizzle-orm')
  return { db: getDb(), schema, eq }
}

beforeAll(async () => {
  const { seedDemo } = await import('../../server/utils/seed')
  await seedDemo() // fresh DB → wasEmpty → seeds the reaping workflow
})

describe('demo seed — reaping workflow', () => {
  it('places one title each in scheduled, appealed, and due', async () => {
    const { db, schema } = await ctx()
    const byState = (s: string) => db.select().from(schema.title).all().filter(t => t.state === s).map(t => t.title)
    expect(byState('scheduled')).toContain('Dormant Unrequested')
    expect(byState('appealed')).toContain('Stale Series')
    expect(byState('due')).toContain('Big Unwatched Movie')
  })

  it('the appealed title has a logged appellant, and history is non-trivial', async () => {
    const { db, schema, eq } = await ctx()
    const stale = db.select().from(schema.title).where(eq(schema.title.title, 'Stale Series')).get()!
    const trans = db.select().from(schema.titleTransition).where(eq(schema.titleTransition.titleId, stale.id)).all()
    expect(trans.some(t => t.reason === 'admin_scheduled')).toBe(true)
    expect(trans.some(t => t.reason === 'member_appealed' && t.actorPersonId != null)).toBe(true)
  })

  it('still pre-immortalises A Comedy and does not disturb scores', async () => {
    const { db, schema, eq } = await ctx()
    const comedy = db.select().from(schema.title).where(eq(schema.title.title, 'A Comedy')).get()!
    expect(comedy.immortalised).toBe(1)
    expect(comedy.state).toBe('eligible')
  })
})
