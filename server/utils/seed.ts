// Default bootstrap + demo-seed (spec §12.2). Demo mode populates SQLite with a
// realistic fake picture so every view renders end-to-end with no source configured.

import { eq, sql } from 'drizzle-orm'
import { getDb, schema } from '../db/client'
import { DEFAULT_SCORING } from '../sync/score'
import { persistBundle } from '../sync/persist'
import { ALL_SOURCES } from '../sources'
import { buildDemoBundle } from './demo-dataset'
import { scheduleTitle, raiseAppeal } from '../reaping/operations'
import { applyTransition } from '../reaping/stateMachine'

export function seedDefaults(): void {
  const db = getDb()

  const defaults: Record<string, string> = {
    grace_days: String(DEFAULT_SCORING.graceDays),
    stale_t1: String(DEFAULT_SCORING.staleT1),
    stale_t2: String(DEFAULT_SCORING.staleT2),
    stale_t3: String(DEFAULT_SCORING.staleT3),
    sync_hour: '3'
  }
  for (const [key, value] of Object.entries(defaults)) {
    db.insert(schema.appSetting).values({ key, value }).onConflictDoNothing().run()
  }

  // Seed connection rows (from env where present) so the settings page lists all four.
  const env: Record<string, { url?: string, key?: string }> = {
    sonarr: { url: process.env.SONARR_URL, key: process.env.SONARR_API_KEY },
    radarr: { url: process.env.RADARR_URL, key: process.env.RADARR_API_KEY },
    seerr: { url: process.env.SEERR_URL, key: process.env.SEERR_API_KEY },
    tautulli: { url: process.env.TAUTULLI_URL, key: process.env.TAUTULLI_API_KEY }
  }
  for (const source of ALL_SOURCES) {
    const e = env[source] ?? {}
    db.insert(schema.sourceConnection).values({
      source,
      baseUrl: e.url ?? null,
      credential: e.key ?? null,
      enabled: e.url && e.key ? 1 : 0,
      lastStatus: 'untested'
    }).onConflictDoNothing().run()
  }
}

export function isDemoMode(): boolean {
  return process.env.REAPARR_DEMO === '1' || process.env.REAPARR_DEMO === 'true'
}

export async function seedDemo(force = false): Promise<void> {
  const db = getDb()
  const titleCount = db.select({ n: sql<number>`count(*)` }).from(schema.title).get()?.n ?? 0
  if (titleCount > 0 && !force) return
  const wasEmpty = titleCount === 0

  const counts = await persistBundle(buildDemoBundle(Date.now()))

  // On the very first seed only, pre-Spare one clearly-keep title so the feature is
  // visible on first run. Skipped on demo re-syncs so a user's own spare choices persist.
  if (wasEmpty) {
    db.update(schema.title)
      .set({ spared: 1, sparedAt: new Date().toISOString() })
      .where(eq(schema.title.title, 'A Comedy'))
      .run()

    // Seed the reaping workflow so The Sands and The Appointed Hour render on first run:
    // one scheduled, one appealed (floated to the top), one due (ready to action).
    const now = Date.now()
    const idOf = (name: string) =>
      db.select({ id: schema.title.id }).from(schema.title).where(eq(schema.title.title, name)).get()?.id
    // Make one demo person a member so there is an appellant + a notification recipient.
    const alice = db.select().from(schema.person).where(eq(schema.person.displayName, 'Alice A')).get()
    if (alice) db.update(schema.person).set({ isMember: 1 }).where(eq(schema.person.id, alice.id)).run()

    const scheduled = idOf('Dormant Unrequested')
    if (scheduled) await scheduleTitle(db, scheduled, { graceDays: 5, actorPersonId: null }, now)

    const appealed = idOf('Stale Series')
    if (appealed && alice) {
      await scheduleTitle(db, appealed, { graceDays: 6, actorPersonId: null }, now)
      raiseAppeal(db, appealed, alice.id, now)
    }

    const due = idOf('Big Unwatched Movie')
    if (due) {
      await scheduleTitle(db, due, { graceDays: 3, actorPersonId: null }, now)
      applyTransition(db, due, { to: 'due', reason: 'grace_elapsed', actor: { system: 'sync' }, now })
    }
  }

  db.insert(schema.syncRun).values({
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    status: 'ok',
    countsJson: JSON.stringify({ ...counts, mode: 'demo' })
  }).run()
}

export async function bootstrap(): Promise<void> {
  seedDefaults()
  if (isDemoMode()) await seedDemo(false)
}
