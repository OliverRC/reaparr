# Reaparr — Technical Plan

*The build blueprint. Turns the specification (reaparr-spec.md v0.14) into a concrete data model, module structure, pipeline, and milestone sequence. Reference the spec for the "what/why"; this document is the "how."*

**Status:** Plan v0.1
**Companion to:** `reaparr-spec.md`

---

## 1. Architecture at a glance

A single Nuxt full-stack app, containerised, talking to four LAN services on a daily cycle and serving a read-only dashboard from a local SQLite cache.

- **Framework:** Nuxt 3 / Vue 3, Nitro server (`node-server` preset).
- **UI:** NuxtUI.
- **DB:** SQLite via **Drizzle ORM** + `better-sqlite3`, file on a volume mount.
- **Packaging:** Docker on Unraid (Community Apps template); volume for the `.db` + config.
- **No auth in MVP** (LAN-trusted); auth-provider seam designed but unused (§9.4 / §12.4 of spec).

**Data flow (one sync):**

```
Sonarr /series ─┐
Radarr /movie  ─┤
Seerr /request ─┼─► normalize ─► join on tmdb/tvdb ─► resolve people ─► score ─► SQLite ─► dashboard
Tautulli hist. ─┘                                     (email|username)   (v1)
```

The dashboard never calls the four sources live — it reads the cache. Sync runs daily + on demand.

---

## 2. Project structure

```
reaparr/
├─ nuxt.config.ts
├─ app.config.ts                 # NuxtUI theme
├─ drizzle.config.ts
├─ server/
│  ├─ db/
│  │  ├─ schema.ts               # Drizzle table definitions (§3)
│  │  ├─ client.ts               # better-sqlite3 + drizzle init
│  │  └─ migrations/             # generated
│  ├─ sources/                   # one adapter per source (§4)
│  │  ├─ types.ts                # SourceClient interface, auth injection
│  │  ├─ http.ts                 # shared fetch w/ auth + timeout + redaction
│  │  ├─ sonarr.ts
│  │  ├─ radarr.ts
│  │  ├─ seerr.ts
│  │  └─ tautulli.ts
│  ├─ sync/
│  │  ├─ run.ts                  # orchestrator (§5)
│  │  ├─ join.ts                 # tmdb/tvdb title join
│  │  ├─ identity.ts             # auto-match (§6)
│  │  └─ score.ts                # Reap Score v1 (§7)
│  ├─ api/                       # Nitro route handlers (§8)
│  │  ├─ dashboard.get.ts
│  │  ├─ sync.post.ts
│  │  ├─ sync/status.get.ts
│  │  ├─ settings/connections.{get,put}.ts
│  │  ├─ settings/connections/[source]/test.post.ts
│  │  ├─ settings/scoring.{get,put}.ts
│  │  └─ people/...              # reconciliation
│  ├─ tasks/daily-sync.ts        # Nitro scheduled task
│  └─ utils/seed.ts              # demo-seed (§9)
├─ app/                          # Vue pages/components (§8.4)
│  ├─ pages/index.vue            # dashboard
│  ├─ pages/settings/*.vue
│  └─ pages/people.vue
├─ test/
│  ├─ fixtures/                  # captured/representative payloads (§9)
│  ├─ mock-server/               # stub source server (§9)
│  └─ unit/                      # scoring, join, identity tests
└─ Dockerfile
```

---

## 3. Data model (SQLite)

Presented as SQL DDL for clarity; the Drizzle schema in `schema.ts` mirrors it 1:1. All timestamps are ISO-8601 text (SQLite has no native datetime); sizes are bytes (`INTEGER`).

### 3.1 Connections & config

```sql
CREATE TABLE source_connection (
  source        TEXT PRIMARY KEY,            -- 'sonarr'|'radarr'|'seerr'|'tautulli'
  base_url      TEXT,
  credential    TEXT,                        -- API key; write-only to UI (§9.6 spec)
  enabled       INTEGER NOT NULL DEFAULT 0,
  last_status   TEXT,                        -- 'ok'|'error'|'untested'
  last_error    TEXT,
  last_tested_at  TEXT,
  last_synced_at  TEXT
);

CREATE TABLE app_setting (                   -- scoring knobs + sync time
  key   TEXT PRIMARY KEY,                     -- 'grace_days','stale_t1','stale_t2','stale_t3','sync_hour'
  value TEXT NOT NULL
);
```

### 3.2 Titles (from Sonarr/Radarr — the spine)

```sql
CREATE TABLE title (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  media_type    TEXT NOT NULL,               -- 'series'|'movie'
  source        TEXT NOT NULL,               -- 'sonarr'|'radarr'
  source_id     INTEGER NOT NULL,            -- Sonarr/Radarr internal id
  tmdb_id       INTEGER,
  tvdb_id       INTEGER,
  imdb_id       TEXT,
  title         TEXT NOT NULL,
  year          INTEGER,
  added_at      TEXT,                        -- server 'added' → age & idle-if-never
  size_on_disk  INTEGER NOT NULL DEFAULT 0,
  season_count  INTEGER,                     -- series only (FR-5)
  downloaded_episodes INTEGER,               -- series: statistics.episodeFileCount
  series_status TEXT,                        -- 'continuing'|'ended' (airing guard, §7)
  series_type   TEXT,                        -- 'standard'|'anime'
  UNIQUE(source, source_id)
);
CREATE INDEX idx_title_tmdb ON title(tmdb_id);
CREATE INDEX idx_title_tvdb ON title(tvdb_id);

CREATE TABLE season (                         -- per-season size (free from /series; "Later" in spec)
  title_id      INTEGER NOT NULL REFERENCES title(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL,
  size_on_disk  INTEGER NOT NULL DEFAULT 0,
  episode_files INTEGER,
  PRIMARY KEY (title_id, season_number)
);
```

### 3.3 People & identities (§6 of spec)

```sql
CREATE TABLE person (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  match_status TEXT NOT NULL DEFAULT 'auto'  -- 'auto'|'confirmed'|'needs_review'
);

CREATE TABLE source_identity (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id     INTEGER REFERENCES person(id) ON DELETE SET NULL,
  source        TEXT NOT NULL,               -- 'seerr'|'tautulli'
  source_user_id TEXT NOT NULL,
  username      TEXT,                         -- Plex username (match key)
  email         TEXT,                         -- (match key)
  friendly_name TEXT,                         -- Tautulli display only — NOT a match key
  UNIQUE(source, source_user_id)
);
CREATE INDEX idx_identity_email ON source_identity(email);
CREATE INDEX idx_identity_username ON source_identity(username);
```

### 3.4 Requests & watches (joined to titles)

```sql
CREATE TABLE request (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  seerr_id      INTEGER NOT NULL UNIQUE,
  title_id      INTEGER REFERENCES title(id) ON DELETE SET NULL,  -- null until/unless joined
  tmdb_id       INTEGER,
  tvdb_id       INTEGER,
  media_type    TEXT,                         -- 'movie'|'tv'
  status        INTEGER,                      -- Seerr status code
  requested_at  TEXT,
  requested_by_person_id INTEGER REFERENCES person(id) ON DELETE SET NULL
);
CREATE INDEX idx_request_title ON request(title_id);

-- distinct episodes (or movie) consumed by ANYONE → completion numerator + last-watched
CREATE TABLE watched_item (
  title_id      INTEGER NOT NULL REFERENCES title(id) ON DELETE CASCADE,
  item_key      TEXT NOT NULL,               -- episode rating_key (series) or movie rating_key
  last_watched_at TEXT,
  PRIMARY KEY (title_id, item_key)
);

-- per-person attribution → "watched by" column (distinct persons per title)
CREATE TABLE title_watcher (
  title_id        INTEGER NOT NULL REFERENCES title(id) ON DELETE CASCADE,
  person_id       INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  last_watched_at TEXT,
  PRIMARY KEY (title_id, person_id)
);

-- rating_key → external IDs cache (avoids re-calling Tautulli get_metadata)
CREATE TABLE metadata_cache (
  rating_key     TEXT PRIMARY KEY,
  grandparent_rating_key TEXT,
  media_type     TEXT,
  tmdb_id        INTEGER,
  tvdb_id        INTEGER,
  imdb_id        TEXT,
  resolved_at    TEXT
);
```

### 3.5 Scores & sync state

```sql
CREATE TABLE score (
  title_id    INTEGER PRIMARY KEY REFERENCES title(id) ON DELETE CASCADE,
  reap_score  INTEGER NOT NULL,              -- 0..100
  staleness   INTEGER NOT NULL,              -- S 0..50
  abandonment INTEGER NOT NULL,              -- A 0..30
  request_miss INTEGER NOT NULL,             -- R 0|20
  idle_days   INTEGER,
  completion  REAL,                          -- 0..1
  freshness   REAL,                          -- 0..1
  tier        TEXT,                          -- 'fresh'|'stale'|'very_stale'|'dormant'
  reasons     TEXT,                          -- JSON array of chip strings (FR-13)
  computed_at TEXT NOT NULL
);

CREATE TABLE sync_run (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  status      TEXT NOT NULL,                 -- 'running'|'ok'|'partial'|'error'
  counts_json TEXT,                          -- per-source row counts
  error       TEXT
);
```

**Derived dashboard view** (computed in the dashboard query, not stored): a title's `last_watched_at = MAX(watched_item.last_watched_at)`, `watched = EXISTS(watched_item)`, `watched_by = title_watcher persons`, `requested_by = request.requested_by_person_id`.

---

## 4. Source clients

### 4.1 Shared shape

```ts
// server/sources/types.ts
export type Source = 'sonarr' | 'radarr' | 'seerr' | 'tautulli'

export type AuthInjection =
  | { kind: 'header'; name: 'X-Api-Key' }                    // sonarr, radarr, seerr
  | { kind: 'query'; param: 'apikey' }                       // tautulli (+ cmd param)

export interface ProbeResult { ok: boolean; message: string }

export interface SourceClient {
  source: Source
  probe(): Promise<ProbeResult>          // §9.6 spec test-connection
}
```

`http.ts` provides one fetch wrapper that: injects auth per `AuthInjection`, sets a timeout, and **redacts credentials from any logged URL** (critical for Tautulli's query-string key). Every adapter is built on it.

### 4.2 Per-source surface (from Appendix A of spec)

| Client | Method | Endpoint | Returns (Reaparr fields) |
|---|---|---|---|
| **Sonarr** | `getSeries()` | `GET /api/v3/series` | id, title, year, tvdbId, tmdbId, imdbId, added, statistics.sizeOnDisk, statistics.seasonCount, statistics.episodeFileCount, seasons[].statistics.sizeOnDisk, status, seriesType, tags |
| | `probe()` | `GET /api/v3/system/status` | ok/message |
| **Radarr** | `getMovies()` | `GET /api/v3/movie` | id, title, year, tmdbId, imdbId, sizeOnDisk, hasFile, added |
| | `probe()` | `GET /api/v3/system/status` | ok/message |
| **Seerr** | `getRequests()` | `GET /api/v1/request` (paged take/skip) | id, status, createdAt, requestedBy{email,plexUsername,username}, media{tmdbId,tvdbId,mediaType} |
| | `getUsers()` | `GET /api/v1/user` | id, email, plexUsername, username |
| | `probe()` | `GET /api/v1/status` | ok/message |
| **Tautulli** | `getHistory()` | `?cmd=get_history` (paged length/start, `after`) | date/stopped, user_id, user, friendly_name, media_type, rating_key, grandparent_rating_key, watched_status, percent_complete |
| | `getUsers()` | `?cmd=get_users` | user_id, username, friendly_name, email |
| | `getMetadata(ratingKey)` | `?cmd=get_metadata` | guids[] → tmdb/tvdb/imdb (cached) |
| | `probe()` | `?cmd=get_server_info` | ok/message |

Each adapter returns **normalised typed objects**, not raw payloads — the rest of the pipeline never sees source-shaped JSON.

---

## 5. Sync pipeline

`server/sync/run.ts`, invoked by the daily scheduled task and by `POST /api/sync`. Single transaction per phase; a failed source degrades to `partial`, never aborts the whole run.

**Order matters** (later phases depend on earlier):

1. **Fetch titles** — Sonarr `getSeries()` + Radarr `getMovies()` → upsert `title` (+ `season`). This is the authoritative set of on-disk items.
2. **Fetch people** — Seerr `getUsers()` + Tautulli `getUsers()` → upsert `source_identity`.
3. **Resolve identities** — run auto-match (§6) → create/update `person`, link identities, flag `needs_review`.
4. **Fetch requests** — Seerr `getRequests()` → upsert `request`; join to `title` on tmdb/tvdb; set `requested_by_person_id` via the requester's `source_identity → person`.
5. **Fetch watches** — Tautulli `getHistory()` (since last sync via `after`):
   - For each row, resolve its `grandparent_rating_key`/`rating_key` to external IDs via `metadata_cache` (call `getMetadata` only on cache miss).
   - Map to a `title` (tmdb/tvdb). Upsert `watched_item` (distinct episode/movie key + last_watched). Upsert `title_watcher` (person + last_watched).
6. **Score** — for every title, assemble `TitleFacts` and compute the Reap Score (§7) → upsert `score`.
7. **Finalise** — write `sync_run` counts/status; stamp `source_connection.last_synced_at`.

**`TitleFacts` assembled per title** (the scorer's only input):

```ts
interface TitleFacts {
  addedAt: string
  watched: boolean                 // EXISTS watched_item
  lastWatchedAt: string | null     // MAX(watched_item.last_watched_at)
  completion: number               // series: distinct watched_item ÷ downloaded_episodes
                                   // movie: watched_status (1 / 0.5 / 0)
  requested: boolean               // EXISTS request for this title
  seriesAiring: boolean            // series_status == 'continuing' (airing guard)
}
```

**Airing guard (spec §8.5 edge case):** for a continuing series, clamp `completion`'s denominator to *downloaded* episodes (already the rule) and don't let "more episodes will exist later" inflate abandonment. `downloaded_episodes` is the denominator, so an ongoing show you've kept up with reads as ~complete.

---

## 6. Identity auto-match

`server/sync/identity.ts`. Implements the decided rule (spec §6.2): match on **email OR Plex username**, case-insensitive/trimmed; conflicts → `needs_review`; never match on `friendly_name`.

```
normalize(x) = lower(trim(x))

build two indexes over source_identity:
  byEmail[normalize(email)] → [identities]
  byUser[normalize(username)] → [identities]

for each identity not yet assigned a person:
  candidates = byEmail[email] ∪ byUser[username]   (excluding self, other source)
  matches = candidates from the *other* source
  if matches resolve to exactly one person/identity:
      if email agrees AND username agrees → link, status unchanged
      if only one of email/username agrees, the other is null → link
      if email points to A but username to B (conflict) → link none, mark both needs_review
  if no match → create a new single-source person (status 'auto')

display_name = friendly_name ?? username ?? email-local-part
```

Persons already `confirmed` by the user are never silently re-merged; new evidence that conflicts flags `needs_review` instead. The reconciliation UI (§8.4) acts only on `needs_review` + manual merges.

**Note:** identity errors can only mislabel a "who" column — the score is identity-independent (spec §6 callout), so this stage is allowed to be imperfect.

---

## 7. Reap Score v1

`server/sync/score.ts`. Pure function, fully unit-testable against fixtures (no I/O).

```ts
interface ScoringConfig {
  graceDays: number   // 30
  staleT1: number     // 90  (3 mo)
  staleT2: number     // 180 (6 mo)
  staleT3: number     // 365 (12 mo)
}

function stalenessRamp(idleDays: number, c: ScoringConfig): number {
  if (idleDays < c.staleT1) return 0
  if (idleDays < c.staleT2) return 1 / 3   // Stale
  if (idleDays < c.staleT3) return 2 / 3   // Very stale
  return 1                                 // Dormant
}

function reapScore(f: TitleFacts, c: ScoringConfig, now = Date.now()): ScoreResult {
  const idleDays = daysBetween(f.watched ? f.lastWatchedAt! : f.addedAt, now)
  const S = Math.round(50 * stalenessRamp(idleDays, c))
  const A = Math.round(30 * (1 - f.completion))
  const R = (f.requested && !f.watched) ? 20 : 0
  const raw = S + A + R
  const freshness = clamp(daysBetween(f.addedAt, now) / c.graceDays, 0, 1)
  const reap = Math.round(raw * freshness)
  return { reap, S, A, R, idleDays, completion: f.completion, freshness,
           tier: tierLabel(idleDays, c), reasons: buildReasons(f, S, A, R, idleDays) }
}
```

Weights **50 / 30 / 20 are fixed** (spec, confirmed). Only `ScoringConfig` (tier boundaries + grace) is adjustable, sourced from `app_setting`. `buildReasons` emits the at-a-glance chips (FR-13): tier label + a completion phrase + a request/never-watched note, e.g. `["Dormant", "Abandoned ~40% in", "Requested by Alex"]`.

**Default sort:** `reap_score DESC`. Size is a separate sortable column, never folded in (spec §8.3).

---

## 8. Server API & frontend

### 8.1 Routes

| Route | Purpose |
|---|---|
| `GET /api/dashboard?type=series\|movie&sort=score\|size` | Ranked rows from the cache (joins title + score + request + watchers). |
| `POST /api/sync` | Trigger a sync now (FR-16). Returns the `sync_run` id. |
| `GET /api/sync/status` | Latest run state + per-source last-synced (for the health strip). |
| `GET/PUT /api/settings/connections` | Read/update the four connections (credentials write-only). |
| `POST /api/settings/connections/[source]/test` | Run the source probe (FR-17a). |
| `GET/PUT /api/settings/scoring` | The two knobs (tiers + grace). |
| `GET /api/people` | Persons + `needs_review` queue. |
| `POST /api/people/merge` · `/split` · `/confirm` | Reconciliation actions. |

### 8.2 Pages (NuxtUI)

- **`/` Dashboard** — `UTabs` (Series / Movies) → `UTable` sorted by Reap Score. Columns: title, seasons (series), **size** (sortable, companion), requested-by, watched-by, last-watched, **Reap Score** + reason chips (`UBadge`). A header **health strip** (per-source connected/last-synced) and a **Sync now** button.
- **`/settings/connections`** — one card per source: base URL, credential (write-only, shows "•••• set"), **Test connection**, status.
- **`/settings/scoring`** — the two knobs only (tier boundaries, grace days), with the defaults visible. No rule builder (spec hard line).
- **`/people`** — auto-matched persons + a `needs_review` queue with merge/confirm.

---

## 9. Testability & build assets (spec §12)

- **Fixtures** (`test/fixtures/`): representative payloads for each source's probe + list endpoints, derived from the OpenAPI/specs, with known expected `TitleFacts` and scores.
- **Mock source server** (`test/mock-server/`): serves the fixtures at the four sources' real paths (incl. Tautulli's `cmd` query shape). Adapters point at `http://localhost:<port>`; exercises probe + full sync with zero credentials.
- **Demo-seed** (`server/utils/seed.ts`): populates SQLite with realistic fake titles/people/requests/watches → every view renders with no source configured (also the product's empty-state UX).
- **Auth seam:** unused in MVP; the provider interface exists so Phase-1 Plex login adds no test-time human step.

**Two-tier definition of done (spec §12.5):**

- **Core (self-validating):** build + typecheck; unit tests green (scoring, ramp tiers, identity match incl. conflict, completion math); app boots; all views render on demo-seed; adapters pass probe + sync against the mock server.
- **Live acceptance (~5 min, needs you):** enter real API keys for the four sources; run one live sync; spot-check real titles/sizes/last-watched/scores.

---

## 10. Milestones (mock-first sequencing)

| # | Milestone | Exit criteria |
|---|---|---|
| **M0** | Scaffold | Nuxt + NuxtUI + Drizzle + SQLite wired; DDL migrates; container builds. |
| **M1** | Source clients + fixtures | Four adapters with typed returns; auth injection per source; unit tests parse fixtures correctly. |
| **M2** | Pipeline core | Join + identity match + scoring implemented; unit-tested against fixtures with known expected scores. |
| **M3** | Mock server | Probe + full sync run green against the stub; `score`/`title`/`person` populated end-to-end, no credentials. |
| **M4** | UI | Demo-seed + dashboard (ranked, chips, size column), settings (test-connection), reconciliation page. |
| **M5** | Live acceptance | Real keys, one live sync, spot-check. Ship the Community Apps template. |

M0–M4 need no live credentials. Only M5 is human-gated.

---

## 11. Open items carried from the spec

- **D-4** (dashboard access scope) — deferred to Phase 1 with auth.
- **Phase-1 backlog:** auth (Plex OAuth), deletion actions (Sonarr/Radarr delete APIs), per-season candidacy, non-admin self-service, trend charts.
- **Confirm at M1 against live-ish data:** Tautulli `watched_status` threshold for "counts as watched" (default: `== 1`); exact Seerr `status` codes to treat as "requested" vs declined.

---

*End of technical plan v0.1.*
