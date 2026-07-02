import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

// Demo vs real data live in SEPARATE db files so a demo sync can never clobber
// real data. Mode is derived here (not imported from utils/seed to avoid a cycle):
//   demo  → <REAPARR_DATA_DIR|./data>/reaparr.db
//   real  → <REAPARR_DATA_DIR|./data-prod>/reaparr.db
// REAPARR_DB_PATH still overrides both (explicit Docker/volume setups).
function isDemo(): boolean {
  return process.env.REAPARR_DEMO === '1' || process.env.REAPARR_DEMO === 'true'
}

function resolveDbPath(): string {
  if (process.env.REAPARR_DB_PATH) return process.env.REAPARR_DB_PATH
  const dataDir = process.env.REAPARR_DATA_DIR
    || join(process.cwd(), isDemo() ? 'data' : 'data-prod')
  return join(dataDir, 'reaparr.db')
}

let _sqlite: Database.Database | null = null
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null

// Bootstrap DDL — idempotent (CREATE TABLE IF NOT EXISTS). Mirrors schema.ts 1:1.
const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS source_connection (
  source TEXT PRIMARY KEY,
  base_url TEXT,
  credential TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  last_status TEXT,
  last_error TEXT,
  last_tested_at TEXT,
  last_synced_at TEXT
);

CREATE TABLE IF NOT EXISTS app_setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS title (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_type TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  tmdb_id INTEGER,
  tvdb_id INTEGER,
  imdb_id TEXT,
  title TEXT NOT NULL,
  year INTEGER,
  title_slug TEXT,
  tautulli_key TEXT,
  added_at TEXT,
  size_on_disk INTEGER NOT NULL DEFAULT 0,
  season_count INTEGER,
  downloaded_episodes INTEGER,
  series_status TEXT,
  series_type TEXT,
  rating REAL,
  rating_imdb REAL,
  rating_rt INTEGER,
  spared INTEGER NOT NULL DEFAULT 0,
  spared_at TEXT,
  state TEXT NOT NULL DEFAULT 'eligible',
  episode INTEGER NOT NULL DEFAULT 1,
  scheduled_at TEXT,
  due_at TEXT,
  send_reminder INTEGER NOT NULL DEFAULT 0,
  removed_at TEXT,
  UNIQUE(source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_title_tmdb ON title(tmdb_id);
CREATE INDEX IF NOT EXISTS idx_title_tvdb ON title(tvdb_id);

CREATE TABLE IF NOT EXISTS season (
  title_id INTEGER NOT NULL REFERENCES title(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL,
  size_on_disk INTEGER NOT NULL DEFAULT 0,
  episode_files INTEGER,
  PRIMARY KEY (title_id, season_number)
);

CREATE TABLE IF NOT EXISTS person (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_key TEXT,
  display_name TEXT NOT NULL,
  custom_name TEXT,
  is_member INTEGER NOT NULL DEFAULT 0,
  is_hidden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS source_identity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER REFERENCES person(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  source_user_id TEXT NOT NULL,
  username TEXT,
  email TEXT,
  friendly_name TEXT,
  UNIQUE(source, source_user_id)
);
CREATE INDEX IF NOT EXISTS idx_identity_email ON source_identity(email);
CREATE INDEX IF NOT EXISTS idx_identity_username ON source_identity(username);

CREATE TABLE IF NOT EXISTS request (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seerr_id INTEGER NOT NULL UNIQUE,
  title_id INTEGER REFERENCES title(id) ON DELETE SET NULL,
  tmdb_id INTEGER,
  tvdb_id INTEGER,
  media_type TEXT,
  status INTEGER,
  requested_at TEXT,
  requested_by_person_id INTEGER REFERENCES person(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_request_title ON request(title_id);

CREATE TABLE IF NOT EXISTS watched_item (
  title_id INTEGER NOT NULL REFERENCES title(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  last_watched_at TEXT,
  watched_status REAL,
  PRIMARY KEY (title_id, item_key)
);

CREATE TABLE IF NOT EXISTS title_watcher (
  title_id INTEGER NOT NULL REFERENCES title(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  last_watched_at TEXT,
  PRIMARY KEY (title_id, person_id)
);

CREATE TABLE IF NOT EXISTS metadata_cache (
  rating_key TEXT PRIMARY KEY,
  grandparent_rating_key TEXT,
  media_type TEXT,
  tmdb_id INTEGER,
  tvdb_id INTEGER,
  imdb_id TEXT,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS score (
  title_id INTEGER PRIMARY KEY REFERENCES title(id) ON DELETE CASCADE,
  reap_score INTEGER NOT NULL,
  staleness INTEGER NOT NULL,
  abandonment INTEGER NOT NULL,
  request_miss INTEGER NOT NULL,
  idle_days INTEGER,
  completion REAL,
  freshness REAL,
  tier TEXT,
  reasons TEXT,
  computed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_run (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  counts_json TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS title_transition (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER NOT NULL REFERENCES title(id) ON DELETE CASCADE,
  episode INTEGER NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_person_id INTEGER REFERENCES person(id) ON DELETE SET NULL,
  actor_system TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transition_title ON title_transition(title_id);

CREATE TABLE IF NOT EXISTS reaping_notification (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER NOT NULL REFERENCES title(id) ON DELETE CASCADE,
  episode INTEGER NOT NULL,
  event TEXT NOT NULL,
  channel TEXT NOT NULL,
  person_id INTEGER REFERENCES person(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  metadata TEXT
);
CREATE INDEX IF NOT EXISTS idx_notification_title ON reaping_notification(title_id);
`

// Add columns introduced after a DB was first created (bootstrap's IF NOT EXISTS
// only creates whole tables). Safe to run every startup.
function ensureColumns(sqlite: Database.Database): void {
  const migrations: Record<string, Array<[string, string]>> = {
    title: [
      ['title_slug', 'TEXT'],
      ['tautulli_key', 'TEXT'],
      ['spared', 'INTEGER NOT NULL DEFAULT 0'],
      ['spared_at', 'TEXT'],
      ['rating', 'REAL'],
      ['rating_imdb', 'REAL'],
      ['rating_rt', 'INTEGER'],
      ['state', 'TEXT NOT NULL DEFAULT \'eligible\''],
      ['episode', 'INTEGER NOT NULL DEFAULT 1'],
      ['scheduled_at', 'TEXT'],
      ['due_at', 'TEXT'],
      ['send_reminder', 'INTEGER NOT NULL DEFAULT 0'],
      ['removed_at', 'TEXT']
    ],
    person: [
      ['is_member', 'INTEGER NOT NULL DEFAULT 0'],
      ['is_hidden', 'INTEGER NOT NULL DEFAULT 0'],
      // ADR-0007: match_status retired (left vestigial on old DBs); match_key + custom_name added.
      ['match_key', 'TEXT'],
      ['custom_name', 'TEXT']
    ]
  }
  for (const [table, add] of Object.entries(migrations)) {
    const cols = new Set(
      (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name)
    )
    for (const [name, type] of add) {
      if (!cols.has(name)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`)
    }
  }
}

// One-time backfill (ADR-0007): give pre-existing persons a match_key derived from their identities
// (normalized email, else 'source:source_user_id'), so the first reconcile after upgrading matches
// them by key and preserves their is_member/is_hidden/custom_name and any actor references — instead
// of deleting and recreating every person. Runs only while persons still lack a key. Persons with no
// identity, or a key already claimed by another person, are left null: reconcile resolves them.
function backfillPersonMatchKey(sqlite: Database.Database): void {
  const pending = sqlite.prepare(`SELECT id FROM person WHERE match_key IS NULL`).all() as { id: number }[]
  if (pending.length === 0) return
  const identitiesFor = sqlite.prepare(
    `SELECT source, source_user_id AS sid, email FROM source_identity WHERE person_id = ? ORDER BY id`
  )
  const setKey = sqlite.prepare(`UPDATE person SET match_key = ? WHERE id = ?`)
  const used = new Set(
    (sqlite.prepare(`SELECT match_key FROM person WHERE match_key IS NOT NULL`).all() as { match_key: string }[])
      .map(r => r.match_key)
  )
  for (const p of pending) {
    const ids = identitiesFor.all(p.id) as { source: string, sid: string, email: string | null }[]
    const withEmail = ids.find(i => i.email && i.email.trim())
    const key = withEmail ? withEmail.email!.trim().toLowerCase() : (ids[0] ? `${ids[0].source}:${ids[0].sid}` : null)
    if (!key || used.has(key)) continue
    used.add(key)
    setKey.run(key, p.id)
  }
}

export function getSqlite(): Database.Database {
  if (_sqlite) return _sqlite
  const dbPath = resolveDbPath()
  const dir = dirname(dbPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.exec(BOOTSTRAP_SQL)
  ensureColumns(sqlite)
  // person.match_key is the reconcile upsert key (ADR-0007) — index after the column exists on both
  // fresh and migrated DBs, then backfill legacy rows so their flags/actor refs survive the upgrade.
  sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_person_match_key ON person(match_key)')
  backfillPersonMatchKey(sqlite)
  _sqlite = sqlite
  return sqlite
}

export function getDb() {
  if (_db) return _db
  _db = drizzle(getSqlite(), { schema })
  return _db
}

export { schema }
