import { sqliteTable, text, integer, real, primaryKey, index } from 'drizzle-orm/sqlite-core'

// --- 3.1 Connections & config -------------------------------------------------

export const sourceConnection = sqliteTable('source_connection', {
  source: text('source').primaryKey(), // 'sonarr'|'radarr'|'seerr'|'tautulli'
  baseUrl: text('base_url'),
  credential: text('credential'), // API key; write-only to UI
  enabled: integer('enabled').notNull().default(0),
  lastStatus: text('last_status'), // 'ok'|'error'|'untested'
  lastError: text('last_error'),
  lastTestedAt: text('last_tested_at'),
  lastSyncedAt: text('last_synced_at')
})

export const appSetting = sqliteTable('app_setting', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})

// --- 3.2 Titles (Sonarr/Radarr — the spine) ----------------------------------

export const title = sqliteTable('title', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mediaType: text('media_type').notNull(), // 'series'|'movie'
  source: text('source').notNull(), // 'sonarr'|'radarr'
  sourceId: integer('source_id').notNull(),
  tmdbId: integer('tmdb_id'),
  tvdbId: integer('tvdb_id'),
  imdbId: text('imdb_id'),
  title: text('title').notNull(),
  year: integer('year'),
  titleSlug: text('title_slug'), // Sonarr deep-link slug (series)
  tautulliKey: text('tautulli_key'), // Tautulli rating_key (movie) / grandparent (series)
  addedAt: text('added_at'),
  sizeOnDisk: integer('size_on_disk').notNull().default(0),
  seasonCount: integer('season_count'),
  downloadedEpisodes: integer('downloaded_episodes'),
  seriesStatus: text('series_status'), // 'continuing'|'ended'
  seriesType: text('series_type'), // 'standard'|'anime'
  // Quality ratings from the *arr (source-derived, refreshed each sync). `rating` is
  // the 0–10 headline: Sonarr's consolidated value (series) / Radarr's TMDB (movies).
  // imdb (0–10) and rottenTomatoes (0–100%) are Radarr-only, so null for series.
  rating: real('rating'),
  ratingImdb: real('rating_imdb'),
  ratingRt: integer('rating_rt'),
  // Spared ("keep forever"): excluded from reaping, pinned to the bottom, score hidden.
  spared: integer('spared').notNull().default(0),
  sparedAt: text('spared_at'),
  // Reaping Workflow lifecycle (functional; voice labels are frontend-only). See CONTEXT.md /
  // docs/adr/0001. `state` is denormalized = the latest title_transition.to_state. `episode`
  // increments on resurrection. `removedAt` tombstones the row (never deleted) so history survives.
  state: text('state').notNull().default('eligible'), // 'eligible'|'scheduled'|'appealed'|'due'|'removed'
  episode: integer('episode').notNull().default(1),
  scheduledAt: text('scheduled_at'),
  dueAt: text('due_at'),
  sendReminder: integer('send_reminder').notNull().default(0),
  removedAt: text('removed_at')
}, t => [
  index('idx_title_source').on(t.source, t.sourceId),
  index('idx_title_tmdb').on(t.tmdbId),
  index('idx_title_tvdb').on(t.tvdbId)
])

// Append-only ledger of reaping state changes (one row per transition). Explains how a title
// reached its current state; never updated or deleted. See docs/adr/0003. Separate from
// reaping_notification (what we sent). Exactly one of actorPersonId / actorSystem is populated.
export const titleTransition = sqliteTable('title_transition', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  titleId: integer('title_id').notNull().references(() => title.id, { onDelete: 'cascade' }),
  episode: integer('episode').notNull(),
  fromState: text('from_state').notNull(),
  toState: text('to_state').notNull(),
  reason: text('reason').notNull(), // TransitionReason enum (stateMachine.ts)
  actorPersonId: integer('actor_person_id').references(() => person.id, { onDelete: 'set null' }),
  actorSystem: text('actor_system'), // 'sync'|'system' — set when no human actor
  metadata: text('metadata'), // JSON blob (appeal note, sync run id, seerr request id, new *arr id)
  createdAt: text('created_at').notNull()
}, t => [
  index('idx_transition_title').on(t.titleId)
])

// Send ledger for reaping notifications (what we sent, to whom). Separate from title_transition.
// personId null = broadcast. See docs/adr/0004.
export const reapingNotification = sqliteTable('reaping_notification', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  titleId: integer('title_id').notNull().references(() => title.id, { onDelete: 'cascade' }),
  episode: integer('episode').notNull(),
  event: text('event').notNull(), // 'scheduled'|'reminder'|'reprieved'|'departed'
  channel: text('channel').notNull(), // 'email' (broadcast channels land in M2)
  personId: integer('person_id').references(() => person.id, { onDelete: 'set null' }), // null = broadcast
  status: text('status').notNull(), // 'sent'|'failed'
  sentAt: text('sent_at').notNull(),
  metadata: text('metadata') // JSON blob (error, recipient email)
}, t => [
  index('idx_notification_title').on(t.titleId)
])

export const season = sqliteTable('season', {
  titleId: integer('title_id').notNull().references(() => title.id, { onDelete: 'cascade' }),
  seasonNumber: integer('season_number').notNull(),
  sizeOnDisk: integer('size_on_disk').notNull().default(0),
  episodeFiles: integer('episode_files')
}, t => [
  primaryKey({ columns: [t.titleId, t.seasonNumber] })
])

// --- 3.3 People & identities --------------------------------------------------

export const person = sqliteTable('person', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // Stable natural key across syncs: normalized email, or 'source:source_user_id' for a no-email
  // single-source person. Drives the reconcile upsert so flags + custom name survive a re-sync (ADR-0007).
  matchKey: text('match_key').notNull().unique(),
  displayName: text('display_name').notNull(), // source-derived (friendly_name → username → email); refreshed each sync
  customName: text('custom_name'), // admin override; read side shows custom_name ?? display_name
  // Active member of the server: gets reap notifications (delivery is a future feature).
  isMember: integer('is_member').notNull().default(0),
  // Hidden: kept out of the way (bottom section) — noise you don't want to see.
  isHidden: integer('is_hidden').notNull().default(0)
})

export const sourceIdentity = sqliteTable('source_identity', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  personId: integer('person_id').references(() => person.id, { onDelete: 'set null' }),
  source: text('source').notNull(), // 'seerr'|'tautulli'
  sourceUserId: text('source_user_id').notNull(),
  username: text('username'), // Plex username (match key)
  email: text('email'), // match key
  friendlyName: text('friendly_name') // display only — NOT a match key
}, t => [
  index('idx_identity_email').on(t.email),
  index('idx_identity_username').on(t.username),
  index('idx_identity_src_user').on(t.source, t.sourceUserId)
])

// --- 3.4 Requests & watches ---------------------------------------------------

export const request = sqliteTable('request', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  seerrId: integer('seerr_id').notNull().unique(),
  titleId: integer('title_id').references(() => title.id, { onDelete: 'set null' }),
  tmdbId: integer('tmdb_id'),
  tvdbId: integer('tvdb_id'),
  mediaType: text('media_type'), // 'movie'|'tv'
  status: integer('status'),
  requestedAt: text('requested_at'),
  requestedByPersonId: integer('requested_by_person_id').references(() => person.id, { onDelete: 'set null' })
}, t => [
  index('idx_request_title').on(t.titleId)
])

export const watchedItem = sqliteTable('watched_item', {
  titleId: integer('title_id').notNull().references(() => title.id, { onDelete: 'cascade' }),
  itemKey: text('item_key').notNull(), // episode rating_key (series) or movie rating_key
  lastWatchedAt: text('last_watched_at'),
  watchedStatus: real('watched_status') // 0|0.5|1 (used for movie completion)
}, t => [
  primaryKey({ columns: [t.titleId, t.itemKey] })
])

export const titleWatcher = sqliteTable('title_watcher', {
  titleId: integer('title_id').notNull().references(() => title.id, { onDelete: 'cascade' }),
  personId: integer('person_id').notNull().references(() => person.id, { onDelete: 'cascade' }),
  lastWatchedAt: text('last_watched_at')
}, t => [
  primaryKey({ columns: [t.titleId, t.personId] })
])

export const metadataCache = sqliteTable('metadata_cache', {
  ratingKey: text('rating_key').primaryKey(),
  grandparentRatingKey: text('grandparent_rating_key'),
  mediaType: text('media_type'),
  tmdbId: integer('tmdb_id'),
  tvdbId: integer('tvdb_id'),
  imdbId: text('imdb_id'),
  resolvedAt: text('resolved_at')
})

// --- 3.5 Scores & sync state --------------------------------------------------

export const score = sqliteTable('score', {
  titleId: integer('title_id').primaryKey().references(() => title.id, { onDelete: 'cascade' }),
  reapScore: integer('reap_score').notNull(), // 0..100
  staleness: integer('staleness').notNull(), // S 0..50
  abandonment: integer('abandonment').notNull(), // A 0..30
  requestMiss: integer('request_miss').notNull(), // R 0|20
  idleDays: integer('idle_days'),
  completion: real('completion'),
  freshness: real('freshness'),
  tier: text('tier'), // 'fresh'|'stale'|'very_stale'|'dormant'
  reasons: text('reasons'), // JSON array
  computedAt: text('computed_at').notNull()
})

export const syncRun = sqliteTable('sync_run', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  status: text('status').notNull(), // 'running'|'ok'|'partial'|'error'
  countsJson: text('counts_json'),
  error: text('error')
})
