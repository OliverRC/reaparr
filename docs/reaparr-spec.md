# Reaparr — Project Specification

*A read-only dashboard that surfaces stale, unwatched media on an Unraid server as deletion candidates, so storage can be reclaimed with confidence.*

**Status:** Draft v0.14 — preliminary specification (all four source APIs mapped; identity model; scoring locked)
**Owner:** (you)
**Last updated:** 30 June 2026

---

## 1. Summary

Reaparr is a self-hosted web app that sits alongside an existing *arr media stack and answers one question well: **"What's taking up space that nobody's watching, and how much would I get back by removing it?"**

It pulls data from the services that already hold the answers — Seerr (who requested what), Tautulli (who actually watched what, and when), and Sonarr/Radarr (what files exist and how big they are) — stitches them into a single consolidated picture per title, and presents a **priority-ranked list of deletion candidates** with all the decision-relevant facts at a glance.

For the MVP, Reaparr is **read-only**: it sees, ranks, and tracks. It does not delete anything. The user actions deletions themselves, outside the tool.

Its defining design principle is **glanceable, not configurable** — a deliberate rejection of the rules-engine complexity found in similar tools.

---

## 2. Problem statement

Media — predominantly **series** — gets requested through Seerr, gets partially watched (a few episodes, a season or two) or never watched at all, and then sits on the server indefinitely. That content consumes paid storage that could be repurposed. With drive-buying hitting a practical ceiling, there's a need to reclaim space by identifying content that has stopped earning its keep.

The data to make these decisions largely exists already, but it's **scattered across systems and hard to stitch together**:

- **Request ≠ watch.** The person who requested a title often isn't the person who watched it — and sometimes nobody watched it. Looking at requests alone can't tell you whether something earned its place.
- **No consolidated per-title view.** Size, request origin, watch history, and recency live in four different tools, none of which shows them together.
- **No shared identity.** Identifiers for a given person don't match across Seerr and Plex/Tautulli, so "did Person A's request ever get watched, by anyone?" can't be answered without first reconciling identities.

Existing tools in this space (Maintainerr, and the Janitorr fork) can technically do parts of this, but they lean on **complex configurable rule engines** — collections, AND/OR conditions, nested if/then/else — that are confusing to set up and maintain. Reaparr's goal is to deliver the consolidated insight **without** that complexity.

---

## 3. Goals & non-goals

### 3.1 Goals (MVP)

- Consolidate request, watch, and file-size data into **one view per title**.
- Resolve disparate per-system user identities into a **single canonical person**.
- Produce a **priority-ranked list of deletion candidates**, split by series and movies.
- Show all decision-relevant facts **at a glance** in each row.
- Compute an **opinionated, built-in "Reap Score"** — a single legible signal — with minimal or no user configuration.
- Run as a **Dockerized container on Unraid**, following the *arr design pattern.

### 3.2 Non-goals (MVP)

- **No authentication.** No login of any kind in MVP — Reaparr runs unauthenticated on the trusted LAN (behind the user's existing reverse proxy / network controls). Auth (Plex OAuth or otherwise) is **deferred to Phase 1, post-MVP** (§9.4, §11).
- **No deletion.** Reaparr does not perform or trigger any destructive action. (Deferred — see §11.)
- **No rules engine.** No condition-builder, no rule graph, no per-user rule authoring. This is a permanent design stance, not just an MVP cut.
- **No per-season size breakdown** in MVP — total size per title only. (Deferred.)
- **No multi-tenancy / hosted SaaS.** Single homelab deployment.
- **No write-back to Seerr/Sonarr/Radarr** of any kind in MVP.

---

## 4. Users

| Role | Description | MVP needs |
|---|---|---|
| **Admin (you)** | Owns the server, makes deletion decisions. | Full dashboard, identity mapping, settings, scoring view. |
| **Other Plex users** | The people who request and watch content. | Not direct users of Reaparr in MVP — they appear *in* the data as people, not as logged-in operators. (Could log in to see their own footprint once auth lands — see §11.) |

For MVP, the only operator is the admin, and Reaparr is unauthenticated on the trusted LAN. Who beyond the admin may log in — and the auth mechanism itself — is a **Phase 1** concern (§9.4).

---

## 5. Data sources

Reaparr pulls from whichever API gives the cleanest data for each dimension. The stack is open — no minimal-source constraint.

| Source | Role in Reaparr | Provides |
|---|---|---|
| **Seerr** | Requests + requester identity | What was requested, by whom, when, status. The "who wanted this" side. Carries `plexUsername` + `email` per user — the identity anchor (§6). |
| **Tautulli** | **Sole** watch source | Watch history, watch recency, watch progress, watcher identity (`username`/`friendly_name`/`email`). The "who actually watched this, and when" side. |
| **Sonarr** | Series file authority | Series/season/episode structure, files on disk, **size on disk** per series. Authoritative for what actually exists. |
| **Radarr** | Movie file authority | Movie files, **size on disk** per movie. Authoritative for what actually exists. |
| **NZBGet** | (In stack; not a data source) | Download mechanism only — not state Reaparr reasons about. Flagged in case a use emerges later. |

**Plex is not a Reaparr integration.** Tautulli already *is* the Plex watch layer and exposes the same history through a cleaner API, so there's no reason to call Plex directly for data. Plex's other potential role — login — is **deferred** along with all auth (§9.4). The Plex *account* still matters conceptually as the identity anchor, but that identity (username/email) is already present in the Seerr and Tautulli payloads, so no Plex API call is needed to use it.

**Size-on-disk note:** Sizes come from the Sonarr/Radarr APIs, which already track files down to the episode/movie level — not from scanning the Unraid filesystem directly. This keeps Reaparr aligned with what the *arr apps believe exists, and avoids filesystem-permission and path-mapping headaches.

**Reference material on hand:**
- Seerr OpenAPI spec (uploaded: `seerr-api.yml`)
- Seerr API docs — https://docs.seerr.dev/api/seerr-api/
- Tautulli API reference — https://github.com/Tautulli/Tautulli/wiki/Tautulli-API-Reference

---

## 6. The identity-resolution problem

To attribute a request to actual viewing — by the requester *or* anyone else — Reaparr resolves the people in Seerr and Tautulli into a **canonical person**. The good news: this is **mostly automatic**, because both sources reference the same underlying Plex account. Seerr carries `plexUsername` + `email` on each user; Tautulli carries `username` / `friendly_name` / `email` per Plex user. Those overlapping fields are the join.

**Approach (MVP):**

- Maintain a **canonical Person entity** in Reaparr's own store.
- Each Person maps to one or more **source identities** (a Seerr user, a Tautulli user).
- **Auto-match on Plex username and/or email** — the common anchor present in both payloads — and create canonical Persons automatically where they line up.
- Provide a lightweight **reconciliation UI** for the *residue* only: the cases auto-match can't settle (see below). Manual confirm/merge/override.
- Treat the mapping as **living data** — new users appear, people leave; it stays maintainable, not a one-time import.

This is a **foundational component** — request-to-watch attribution depends on it — but with the Plex-account anchor it's a "match then mop up," not a hard reconciliation from scratch.

> **Why it's lower-stakes than it looks:** the **Reap Score never depends on identity** (§8). Scoring only asks *"did **anyone** watch this title?"* — a property of the watch events themselves. Identity powers only the *display* columns ("requested by" / "watched by"). So a wrong match mislabels a name in a column; it can never mis-score a deletion candidate.

### 6.1 What a canonical Person is

A Person is deliberately thin: **one internal id, a display name, and a set of linked source accounts.** It exists the moment it has ≥1 linked identity — usually two (a Seerr account + a Tautulli account), sometimes one.

| Entity | Fields | Notes |
|---|---|---|
| **Person** | `person_id` (Reaparr's own), `display_name`, `match_status` (auto / confirmed / needs-review) | The canonical spine. `display_name` defaults to Tautulli `friendly_name` → Plex username → email local-part. |
| **SourceIdentity** | `person_id` (FK), `source` (`seerr` \| `tautulli`), `source_user_id`, `email`, `plex_username` | One row per linked account. A Person has one or more. Carries the matchable fields. |

Resolution then runs through these links: a **Seerr request** resolves to its Person via the Seerr SourceIdentity → "requested by"; a **Tautulli watch event** resolves via the Tautulli SourceIdentity → "watched by".

### 6.2 Auto-match rule (decided — D-5)

Two keys, both already present in each system's payload:

1. **email** — on both Seerr users and Tautulli users; the **primary** key.
2. **Plex username** — Seerr `plexUsername` ↔ Tautulli `username` (the same Plex account name); the **corroborator**.

The rule:

- **email matches OR plex_username matches** → link both accounts to one Person, automatically.
- **both present and both agree** → high confidence; linked silently.
- **they conflict** (email points one way, username another) → do **not** guess; flag `needs-review`.
- Matching uses Tautulli's `username`, **never** `friendly_name` — friendly_name is a freely-editable display label and is unsafe to match on (though it's fine as a `display_name` source).

All matching is case-insensitive and trimmed.

### 6.3 What auto-match can't settle (the residue → reconciliation UI)

A small, predictable set lands in the lightweight review screen for manual confirm / merge / override:

- **Watchers with no Seerr account** — appear in Tautulli, absent from Seerr. Valid single-source Person.
- **Plex Home / managed users** — shared-profile accounts that may share or lack an email.
- **Genuine mismatches** — username and email both differ across the two systems.

The mapping is **living data** — new users appear, people leave — so the reconciliation screen is a standing tool, not a one-time import.

### 6.4 Two distinct joins (don't conflate them)

There are two separate matching problems, and with the Plex anchor neither is especially hard:

1. **Person join** — Seerr user ↔ Tautulli user, via shared Plex username/email (§6.2).
2. **Title join** — the same *show or movie* across Seerr, Tautulli, Sonarr, and Radarr. Resolves cleanly on **external metadata IDs**, which every source carries:
   - **Sonarr** series expose `tvdbId`, `imdbId`, `tmdbId`, `titleSlug`.
   - **Radarr** movies expose `tmdbId`, `imdbId`.
   - **Seerr** requests carry `tmdbId`/`tvdbId`.
   - **Tautulli** items carry GUIDs that include tvdb/tmdb/imdb references.

   So `tmdbId` (movies) and `tvdbId`/`tmdbId` (series) are the canonical join keys for stitching a title's request, watch, and file-size records together. No fuzzy title matching.

---

## 7. Size on disk

| Scope | MVP | Later |
|---|---|---|
| **Movies** | Total size — `MovieResource.sizeOnDisk` (single value). | — |
| **Series** | **Total size for the whole series** — `SeriesResource.statistics.sizeOnDisk`. | Per-season breakdown. |

Size is the **payoff column**: it's what turns "nobody's watching this" into "…and here's the ~80 GB you'd get back." It sits *beside* the Reap Score as a companion fact — it does **not** feed the score itself (§8.3) — so the dashboard stays actionable without conflating "should this go?" with "how big is it?"

> **Finding (confirmed from the API specs):** Both sizes come straight off the **list** endpoints — no filesystem scan, no per-item follow-up calls. Even better, **per-season size is effectively free**: each `GET /api/v3/series` response already includes a `seasons[]` array where every entry carries `statistics.sizeOnDisk`. So the "deferred per-season" refinement (D-?, §11) costs no extra integration work whenever you decide to surface it — the data is already in the payload we'd fetch anyway. Series statistics also include `seasonCount` (→ FR-5, number of seasons) and `percentOfEpisodes` (how complete the local copy is), both for free in the same call.

---

## 8. The "Reap Score" — scoring model

This is the heart of the tool and the place where the **glanceable-not-configurable** principle matters most. The score must be **opinionated and built-in**, never user-authored. Reaparr ships with a sensible default notion of "stale" and simply shows the answer.

### 8.1 Design stance

- **One legible number per title.** Higher = stronger deletion candidate.
- **No rule authoring.** No conditions, no branching, no per-title exceptions to configure.
- **Driven by watch + request signals only** — *not* size (§8.3). Size is shown next to the score, never baked into it.
- **At most a couple of knobs**, and only if they earn their place — e.g. a recency threshold. When in doubt, fewer settings.
- **Explainable.** A user should be able to see *why* something scored high (e.g. "Requested 8 months ago · never watched") without reading documentation.

### 8.2 What the score is built from

The Reap Score (0–100, higher = stronger candidate) answers one question — **"how unloved is this?"** — from watch-history and request signals:

- **Recency** — time since last watched; **never-watched is the strongest case**.
- **Engagement** — watch progress: % of episodes / series watched, or movie watched vs not. A series abandoned after one season scores higher than one watched through.
- **Request fulfilment** — **requested but never watched** is a strong positive signal (someone asked for it, nobody — not even the requester — followed through).
- **Age on server** — how long it's been sitting there; older-and-untouched outweighs recently-added-and-untouched.

These are the strong drivers, and they're all watch/request/time-based. The exact weighting and formula is settled at plan stage (scoring formula v1).

### 8.3 Size is *not* in the score (decided — D-2)

**Size on disk does not contribute to the Reap Score.** It's displayed as a **companion column** next to the score — purely the "and here's what you'd reclaim" payoff — but it never moves the score and isn't a default-sort tiebreaker. A 3 GB never-watched series and a 60 GB never-watched series get the *same* Reap Score; they simply show different reclaim figures beside it.

Keeping them orthogonal is deliberate and on-brand for *glanceable-not-configurable*: the score is a pure "should this go?" judgement, and the user's eye does the cheap final step of "…and is it worth it?" by glancing at the size column. (Size remains independently **sortable as a column** if the user wants to hunt big-ticket reclaims, but that's a manual sort, not part of the score.)

### 8.4 Worked example (illustrative)

| Title | Seasons | Size | Requested by | Watched by | Last watched | Reap Score |
|---|---|---|---|---|---|---|
| *Some Anime* | 3 | 64 GB | Person A | — | never | 100 |
| *A Drama* | 5 | 41 GB | Person B | Person C | 14 months ago | 68 |
| *A Comedy* | 2 | 12 GB | Person A | Person A | 3 weeks ago | 0 |

Note the scores track *watch/request*, not size: the 12 GB comedy that's actively watched and finished scores 0, while the 64 GB anime nobody touched scores 100 — and if that anime were 5 GB instead, its score would be unchanged. Size only tells you how much you reclaim *if* you act. The numbers above come straight out of the formula in §8.5.

### 8.5 Rough scoring formula (v1)

A first cut — deliberately simple. Three watch/request components sum to a 0–100 raw score; a grace-period factor then suppresses brand-new content. The **50 / 30 / 20** split (staleness / abandonment / request-miss) is **confirmed**; only the curve internals (tier values, grace days) remain as tunable built-in defaults — never user-facing rules.

**Inputs per title (from synced data):**

| Input | Meaning | Source |
|---|---|---|
| `watched` | ≥1 watch event from **any** user | Tautulli |
| `idle_days` | watched → days since the **most recent** watch; never watched → days since **added** | Tautulli / Sonarr·Radarr `added` |
| `completion` | fraction consumed — series: distinct episodes watched ÷ **downloaded** episode count; movie: 1.0 watched / 0.5 started / 0.0 never | Tautulli + Sonarr·Radarr |
| `requested` | appears in Seerr requests | Seerr |
| `age_days` | days since added to the server | Sonarr·Radarr `added` |

**Components (each a watch/request signal):**

| Component | Range | Formula | Captures |
|---|---|---|---|
| Staleness `S` | 0–50 | `50 × ramp(idle_days)` — stepped, see tiers below | How long since anyone watched — or since it landed, if never |
| Abandonment `A` | 0–30 | `30 × (1 − completion)` | Watched only partly, or not at all |
| Request-miss `R` | 0 or 20 | `20 if (requested and not watched) else 0` | Asked for, then ignored — the core pain pattern |

`ramp(idle_days)` is **stepped into three tiers** at 3, 6, and 12 months — each milestone raises the staleness contribution a notch, maxing out at a year idle:

| Idle time | Tier | `ramp` | Staleness `S` | At-a-glance label |
|---|---|---|---|---|
| < 3 months | — | 0.0 | 0 | *(recently watched / fresh)* |
| 3–6 months | 1 | 0.33 | ~17 | **Stale** |
| 6–12 months | 2 | 0.66 | ~33 | **Very stale** |
| ≥ 12 months | 3 | 1.0 | 50 | **Dormant** |

So something only reads as *fully* stale once it's gone a year untouched; 3 and 6 months are the intermediate steps. The tier labels double as the staleness reason-chip on the dashboard (FR-13). (Tier boundaries and the step values are the tunable staleness knob; thirds — 0 / 17 / 33 / 50 — are the sensible default.)

**Series completion — the "% of the series actually watched."** This is exactly what the **Abandonment** component already measures, via `completion`. For a multi-season series, `completion = distinct episodes watched ÷ episodes **on disk**` (the denominator is what you've *downloaded*, i.e. the bytes actually taking up space — not the full aired run, so grabbing 1 of 5 seasons and watching it doesn't read as "20% abandoned"). Worked through:

| Series situation | completion | Abandonment `A` |
|---|---|---|
| Watched nothing | 0.0 | 30 (max) |
| Watched ~1 of 5 seasons, then stopped | ~0.2 | 24 |
| Watched ~half | 0.5 | 15 |
| Watched almost all | ~0.9 | 3 |
| Finished everything on disk | 1.0 | 0 |

So a big series you bailed on after a season carries most of the abandonment weight; one you nearly finished barely any. Movies collapse to the same scale (watched 1.0 / started 0.5 / never 0.0).

**Combine, then apply the grace period:**

```
raw       = S + A + R                            // 0..100
freshness = clamp(age_days / GRACE_DAYS, 0, 1)   // GRACE_DAYS ≈ 30
ReapScore = round(raw × freshness)               // 0..100
```

The freshness factor is what separates "added last week, not watched yet" from a high score: new content **ramps in over its first ~30 days** instead of being flagged immediately.

**The only two knobs** (both optional, sensibly defaulted, no rule-authoring): the staleness **tiers** (the 3 / 6 / 12-month boundaries and their step values) and **GRACE_DAYS** (new-content grace period, default ~30).

**Why this shape:**

- **Watch dominates.** 80 of 100 points come from watch signals (staleness + abandonment); request contributes a supporting 20. Matches "watch history/request is the strong part; size is not."
- **Unified idle.** Using `idle_days = days-since-last-watch` for watched titles and `days-since-added` for never-watched ones means the same staleness curve serves both, and a never-watched title can't look stale until it's actually been sitting unwatched for a while.
- **Resolves D-7** (never-watched vs watched-long-ago). A long-idle **never-watched** title stacks staleness + full abandonment (+ request-miss) → ~100. A **watched-and-finished** title that's equally idle gets staleness only → ~50. So never-watched ranks **above** watched-long-ago, by construction — no separate rule needed.
- **Size appears nowhere** — exactly as decided (§8.3).

**The §8.4 example, computed** (all past the grace period, so `freshness = 1`):

| Title | idle | completion | requested? | S | A | R | Score |
|---|---|---|---|---|---|---|---|
| *Some Anime* | never (added ~20 mo ago) | 0.0 | yes, unwatched | 50 | 30 | 20 | **100** |
| *A Drama* | 14 mo since last watch | ~0.4 (abandoned ~2 of 5 seasons) | yes, watched | 50 | ~18 | 0 | **68** |
| *A Comedy* | 3 wks since last watch | 1.0 (finished) | yes, watched | 0 | 0 | 0 | **0** |

(*A Drama* sits in the **Dormant** tier — 14 months is past the 12-month mark — so its staleness is maxed at 50; only its partial completion keeps it off 100. Had it last been watched 7 months ago instead, it'd be **Very stale** (S ≈ 33), scoring ~51.)

**Explainability** falls out of the components — the dominant ones become the at-a-glance reason chips (FR-13): *"Never watched · on server 20 months · requested by Person A"*, *"Abandoned ~40% in · last seen 14 months ago"*, *"Actively watched · finished"*.

**Edge cases to handle at plan stage:** currently-airing series (measure completion against *downloaded* episodes, not future ones, so an ongoing show isn't unfairly marked abandoned); a watcher who isn't the requester (counts as watched — score uses *anyone*; the dashboard's "watched by" column shows who); titles present in Sonarr/Radarr but never requested via Seerr (`R = 0`, scored on watch signals alone).

---

## 9. Architecture

### 9.1 Pattern

Reaparr follows the **Sonarr/Radarr/Seerr design pattern**: a Dockerized full-stack web app, web UI as the primary interface, a local SQLite file on a volume mount, running as another container on the Unraid box alongside the rest of the stack (§9.5).

### 9.2 Sync model — poll & cache

Reaparr does **not** hit five live APIs on every page load. Instead, mirroring how the *arr apps work:

- **Scheduled sync** runs **once per day**, pulling from Seerr, Tautulli, Sonarr, and Radarr.
- A manual **"Sync now"** control in the UI triggers an on-demand refresh between daily runs.
- Results are stitched together (via the canonical-person mapping) and **persisted locally**.
- The UI is served from the local store — fast, and resilient to a source being briefly down.
- The local store is also where **identity mappings** and **historical watch trends** live.

### 9.3 Tech stack

| Layer | Choice | Notes |
|---|---|---|
| **Framework** | **Nuxt / Vue** (JavaScript-native) | Full-stack via Nuxt's Nitro server, built with the **node-server** preset for a self-hosted container. |
| **Platform** | Plain Nuxt/Nitro (self-hosted) | **Deployment is decided: Docker on Unraid (§9.5).** That rules out the Cloudflare-hosted NuxtHub model. NuxtHub itself can be revisited only if it cleanly targets a self-hosted Node deploy — otherwise vanilla Nuxt is the fit. See D-1. |
| **UI components** | **NuxtUI** (confirmed) | The component library for the dashboard — tables, layouts, modals, theming out of the box. |
| **Storage** | **SQLite file** | A single `.db` file on a **volume-mounted** path, so it persists across container restarts/updates. (No Cloudflare D1 — that was tied to the hosted model now ruled out.) Access via e.g. Drizzle + better-sqlite3. |
| **Packaging** | **Docker** container on Unraid | Distributed via the Unraid **Community Apps** store; ultimately just a container with volume mounts. |
| **Auth** | **None in MVP** (deferred → Phase 1) | Reaparr runs unauthenticated on the trusted LAN for MVP. Plex OAuth (or another scheme) lands in Phase 1 (§9.4). |

### 9.4 Auth (deferred to Phase 1)

**MVP ships with no authentication.** Reaparr runs on the trusted LAN behind whatever access controls the user already has in front of their *arr stack (reverse proxy, VPN, network isolation). This keeps the MVP focused on the hard, valuable part — consolidation and scoring — and removes the one component that can't be self-validated without interactive setup (see §12).

**Phase 1 (post-MVP)** adds auth. The natural choice is **Plex OAuth** (the PIN flow Tautulli/Seerr lean on), since the audience already has Plex accounts and it dovetails with the identity anchor. When it lands it should sit behind the auth-provider interface described in §12.4 so the rest of the app is unaffected. Open at that point: who beyond the admin may log in, and what a non-admin sees (e.g. only their own footprint).

Note this is independent of the **identity-resolution** work (§6), which does *not* depend on Plex login — it matches on the Plex username/email already present in Seerr and Tautulli data.

### 9.5 Deployment model (decided)

Reaparr ships as a **Docker container that runs on Unraid** — nothing more exotic. It's distributed the way the rest of the stack is: published to the Unraid **Community Apps** store as a template, but underneath that it's just a container the user runs, with a few **volume mounts** for persistent storage.

- **Distribution:** Unraid Community Apps template → one-click install, same as Sonarr/Radarr/Seerr/Tautulli.
- **Runtime:** a single container running the Nuxt/Nitro app (node-server preset).
- **Storage:** a **volume-mounted** directory holding the SQLite `.db` file (and any config), so data survives container restarts and image updates. Maps to a path on the Unraid array, e.g. `/mnt/user/appdata/reaparr → /app/data` in the container.
- **Networking:** runs on the same Docker network / LAN as the *arr stack, so it reaches Seerr, Tautulli, Sonarr, and Radarr **directly** by host:port. No tunnel, no cloud round-trip.

This is the clean, native fit — Reaparr behaves like any other citizen of the *arr ecosystem. It also **closes the earlier Cloudflare/NuxtHub question**: a Cloudflare-hosted app would have sat outside the LAN and needed a tunnel back in to reach the local APIs, which buys nothing here. Self-hosted in Docker is the model.

**Container config (env vars / template fields), to firm up in the plan:**

| Setting | Example |
|---|---|
| Source base URLs | `SONARR_URL`, `RADARR_URL`, `SEERR_URL`, `TAUTULLI_URL` |
| Source API keys | `SONARR_API_KEY`, `RADARR_API_KEY`, `SEERR_API_KEY`, `TAUTULLI_API_KEY` |
| Data path | volume mount for the SQLite file + config |
| Sync interval | how often the background sync runs (default: **daily**) |

> **One remaining sub-decision (D-1, now narrow):** whether to use **NuxtHub** purely for developer ergonomics *if and only if* it cleanly supports a self-hosted Node/Docker target, or to stay on **vanilla Nuxt/Nitro**. The deployment shape itself (Docker-on-Unraid + SQLite-on-volume) is settled either way.

### 9.6 Settings & connection management

Reaparr needs a **Settings page** where each source connection is configured and verified. Env vars (§9.5) can seed initial values, but the UI is the source of truth at runtime — a user should be able to add/edit a connection without recreating the container.

The wrinkle worth designing around: **the sources don't all authenticate the same way.** A single "API key" text box won't cleanly cover them. The settings layer should therefore use a **per-source connection adapter** — each source declares what fields it needs, how its credential is injected into a request, and how to prove the connection works.

| Source | Credential | How it's sent | Test-connection probe |
|---|---|---|---|
| **Sonarr** | API key | `X-Api-Key` header (also accepts `?apikey=`) | `GET /api/v3/system/status` |
| **Radarr** | API key | `X-Api-Key` header | `GET /api/v3/system/status` |
| **Seerr** | API key | `X-Api-Key` header | `GET /api/v1/status` (or `/api/v1/auth/me`) |
| **Tautulli** | API key | **query param**, command-style: `/api/v2?apikey=…&cmd=…` | `cmd=get_server_info` |

So three are header-based API keys (though Seerr's path scheme differs) and Tautulli is a **query-param + `cmd`** model entirely. The adapter abstraction absorbs those differences so the rest of the app talks to a uniform "connection" regardless of source — and leaves a clean slot for the Plex auth-provider when it arrives in Phase 1 (§9.4).

**Each connection in the UI provides:**
- **Base URL** field (host:port on the LAN).
- **Credential** field(s), shaped per the adapter (an API key for all four MVP sources).
- A **Test connection** button that runs the probe above and shows pass/fail with the reason — so misconfig is caught at setup, not silently at sync time.
- A **status indicator** (connected / last-synced / error) reused on a dashboard health strip.

**Secret handling:** credentials are stored in the SQLite file on the mounted volume; they are **never returned to the browser in plaintext** after saving (write-only fields — show "•••• set", allow replace), and never placed in URLs/query strings in logs. This matters especially for Tautulli, whose key rides in the query string — log redaction needs to account for that.

**Adapter contract (shape, for the plan):** each source adapter declares `{ requiredFields, authInjection (header|query|token-flow), probeRequest, healthParser }`. Adding a future source becomes "write one adapter," not "touch the whole settings page."

---

## 10. Functional requirements (MVP)

### 10.1 Dashboard
- **FR-1** Split view: **Series** and **Movies**.
- **FR-2** **Priority-ranked** list, strongest deletion candidates first.
- **FR-3** All decision info visible **at a glance** per row.

### 10.2 Per-series row
- **FR-4** Series name
- **FR-5** Number of seasons
- **FR-6** Total size on disk
- **FR-7** Requested by (canonical person)
- **FR-8** Watched by (canonical person/people, if any)
- **FR-9** Last watched (date / "never")
- **FR-10** Reap Score

### 10.3 Per-movie row
- **FR-11** Equivalent fields, adapted (no season count; single file size; same request/watch/recency/score columns).

### 10.4 Scoring
- **FR-12** Compute a built-in Reap Score per title (§8). No user-authored rules.
- **FR-13** Surface a short, human-readable **reason** for a title's score.

### 10.5 Identity
- **FR-14** Maintain canonical **Person** entities (id + display name + `match_status`) each linked to one or more **SourceIdentity** rows (Seerr / Tautulli) — §6.1.
- **FR-14a** **Auto-match** Seerr↔Tautulli identities on email OR Plex username (case-insensitive), linking them to one Person; conflicts flagged `needs-review` (§6.2).
- **FR-15** Provide a lightweight **reconciliation UI** to review, confirm, merge, and override the residue (§6.3).

### 10.6 Sync & settings
- **FR-16** Background sync from all configured sources, running **once daily**, plus a manual **"Sync now"** button for on-demand refresh.
- **FR-17** Settings page with a **per-source connection** for each of Sonarr, Radarr, Seerr, and Tautulli (§9.6), each handling that source's specific auth mechanism (header key / query+cmd).
- **FR-17a** **Test connection** action per source that runs the source's probe and reports pass/fail with reason.
- **FR-17b** Per-source **status indicator** (connected / last-synced / error).
- **FR-17c** Credentials stored server-side, **never echoed to the browser in plaintext**, and redacted from logs (incl. Tautulli's query-string key).
- **FR-18** Local persistence of the consolidated picture, mappings, and history.

### 10.7 Auth
- **No auth in MVP** (§9.4). Reaparr runs unauthenticated on the trusted LAN.
- *(Phase 1)* **FR-19** Plex OAuth login, behind the auth-provider interface (§12.4).

---

## 11. Out of scope for MVP / future roadmap

- **Authentication (Phase 1)** — login for Reaparr itself, most likely **Plex OAuth**, behind the auth-provider interface (§9.4, §12.4). The first thing to land post-MVP, and the gateway to non-admin self-service below.
- **Actioning deletion** from within Reaparr (Sonarr/Radarr both expose delete via API — comparatively trivial to add once the scoring is trusted). Kept out of v1 to eliminate destructive-action risk while the scoring earns trust.
- **Per-season size and per-season deletion candidacy.**
- **Self-service view for non-admin users** (let a user see their own request/watch footprint).
- **Historical trend charts** (watch decay over time) beyond what's needed to score.
- **Scoring knobs / tuning UI** — only if real-world use shows the defaults need it, and even then kept to one or two sliders.
- **NZBGet integration**, if a use emerges.

---

## 12. Testability, mock mode & demo data

A core build principle: **everything except live credentials is validatable without touching the real servers.** Configuration and authentication are pushed right out to the *edge* of the system, so the entire app — parsing, joining, scoring, every view — can be built and verified against known inputs first, with real keys plugged in only at the very end.

This isn't only a testing convenience; the same machinery doubles as a clean first-run experience and a stable foundation for CI.

### 12.1 Build against the specs, not a live server

The Sonarr and Radarr OpenAPI specs, the Seerr spec, and the Tautulli reference give us authoritative schemas. From them we derive:

- **Typed models** for each source's payloads.
- **Fixtures** — representative sample responses for each source's probe and list endpoints, with **known, deterministic expected outputs** for the pipeline that consumes them.

The tmdb/tvdb/imdb **title join**, the **identity reconciliation**, and the whole **Reap Score** computation are pure transforms over these fixtures, so they're fully unit-testable with zero network access.

### 12.2 Demo-seed mode

A flag that seeds the SQLite DB with realistic fake data — series, movies, requests, watch history, and a few pre-mapped people. With it enabled, the app boots into a fully populated state so that **every view can be exercised end to end without any source configured**: split dashboards render, ranking is correct, score reasons display, the identity-mapping UI works.

Beyond testing, this is a genuinely nice **first-run/empty-state experience** — a new user sees what Reaparr does before wiring up a single key — so it earns its place in the product, not just the test harness.

### 12.3 Mock source server

A small local stub that answers each source's **probe + list endpoints** with fixture data. Point the connection adapters at `http://localhost:<mockport>` and the **Test connection** and **sync** code paths get exercised automatically — including each source's distinct auth shape (header key / query+cmd). Swapping in the real LAN URLs later is then **pure config**: the code path is already proven.

### 12.4 Auth provider seam (for Phase 1)

MVP has **no app login** (§9.4), so there's no interactive auth to gate testing in the first place — a simplifying consequence of deferring auth. The Plex PIN/OAuth flow that arrives in Phase 1 should sit behind an **auth-provider abstraction** with a **fake provider** for tests that injects a token, so that when login lands it doesn't reintroduce a human-in-the-loop dependency for the rest of the suite. Designing that seam now (even unused) keeps the door open without cost.

### 12.5 Two-tier definition of done

Splitting acceptance keeps the human-gated part small and well-marked instead of threaded through everything:

| Tier | Validates | Needs the user? |
|---|---|---|
| **Core (self-validating)** | Builds; types check; unit tests green against fixtures; app boots; **all views render** on seeded data; scoring/ranking correct; adapters pass against the **mock server**; Test-connection and sync paths exercised. | **No.** |
| **Live acceptance (~5 min)** | Enter **real API keys** for the four sources, run **one live sync** against the actual Unraid stack; spot-check that real titles/sizes/watch data look right. | **Yes** — a short, explicit checklist. |

The effect: the config/auth dependency shrinks from "blocks the whole build" to **one final handoff step**, and the bulk of the project reaches a verifiable, green state on its own.

---

## 13. Guiding principles

1. **Glanceable, not configurable.** The product's core differentiator. Here's what you have, here's when it was last watched, here's a rough score — no rules canvas, no if/then/else. When in doubt, remove a setting.
2. **Opinionated defaults.** Reaparr decides what "stale" means and shows the answer; it doesn't ask the user to define it.
3. **Honest about payoff.** Always pair "nobody's watching this" with "here's what you'd reclaim."
4. **Read-only until trusted.** No destructive actions in MVP.
5. **Align with the *arr ecosystem.** Look, feel, and deploy like a citizen of the stack the user already runs.

---

## 14. Open decisions

| # | Decision | Notes / recommendation |
|---|---|---|
| **D-1** | **~~Deployment & storage model~~ → DECIDED** (§9.5) | **Resolved: Docker container on Unraid, distributed via Community Apps, SQLite file on a volume mount, direct LAN access to sources.** Cloudflare/NuxtHub-hosted model dropped. Narrow remainder: vanilla Nuxt vs NuxtHub-only-if-self-hostable. |
| **D-2** | **~~Score composition~~ → DECIDED** (§8.3) | **Resolved: size is NOT part of the Reap Score.** Score is driven by watch-history + request signals only (recency, engagement, request-fulfilment, age). Size is a companion display column, independently sortable, never a scoring input or default tiebreaker. |
| **D-3** | **~~Component library~~ → DECIDED** (§9.3) | **Confirmed: NuxtUI.** |
| **D-4** | **~~Dashboard access scope~~ → DEFERRED** (§9.4) | Moot for MVP — no auth, single admin operator on the LAN. Revisits in Phase 1 when login lands (who may log in, what non-admins see). |
| **D-5** | **~~Identity auto-match signals~~ → DECIDED** (§6.2) | **Resolved: auto-match on email OR Plex username** (Seerr `plexUsername` ↔ Tautulli `username`), case-insensitive; conflicts → `needs-review`; never match on Tautulli `friendly_name`. Canonical Person = id + display name + linked SourceIdentities (§6.1). |
| **D-6** | **~~Sync interval & manual refresh~~ → DECIDED** | **Resolved: sync once per day, plus a manual "Sync now" button** in the UI for on-demand refresh. |
| **D-7** | **~~"Never watched" vs "watched long ago"~~ → DECIDED** (§8.5) | **Resolved by the formula:** never-watched stacks staleness + abandonment (+ request-miss) and ranks above watched-long-ago, which gets staleness alone. No separate rule. |

---

## 15. Next steps

1. Resolve the remaining **open decisions** — D-1 (deployment) and D-2 (scoring excludes size) are settled. The remaining substantive ones are D-6/D-7 (sync cadence; how "never watched" vs "watched long ago" rank), both naturally pinned down when the **scoring formula v1** is written.
2. Turn this spec into a **technical plan**: data model (canonical Person, Title, source-identity, watch-event, request, file-size, score), API integration map per source (endpoints, auth, fields needed), sync job design, and scoring formula v1.
3. From the plan, produce the **build**, sequenced mock-first per §12: typed models + fixtures from the specs → scoring/join/identity transforms (unit-tested) → demo-seed mode + all views → mock source server exercising the four adapters, Test-connection, and sync. **Live credentials enter only at the §12.5 acceptance step.** (App auth is Phase 1, not part of the MVP build.)

---

*End of specification v0.14.*

---

## Appendix A — Source API integration notes

Concrete findings from the source APIs (Radarr/Sonarr OpenAPI v3 — the v3 docs apply to both Sonarr v3 and v4; Seerr from the uploaded `seerr-api.yml`; Tautulli from its API reference). These feed directly into the technical-plan stage.

### A.1 Radarr (movies)

Base: `http://<host>:7878/api/v3` · auth via `X-Api-Key` header (or `apikey` query param).

| Endpoint | Use |
|---|---|
| `GET /movie` | **Primary pull.** Returns all movies in one call. Each has the fields below. |
| `GET /movie/{id}` | Single-movie detail if needed. |
| `GET /diskspace` | Free space per mount — useful context for the reclaim story. |
| `GET /moviefile?movieId=` | File-level detail (only if movie-object fields aren't enough). |

**`MovieResource` fields Reaparr needs:** `id`, `title`, `year`, `tmdbId`, `imdbId`, `sizeOnDisk`, `hasFile`, `movieFileId`, `added` (added-to-server date → age signal), `path`, `tags`, `statistics.sizeOnDisk`. Movie size is a single value — trivial.

### A.2 Sonarr (series)

Base: `http://<host>:8989/api/v3` · auth via `X-Api-Key` header.

| Endpoint | Use |
|---|---|
| `GET /series` | **Primary pull.** Returns all series in one call, each with `statistics` and a `seasons[]` array. Total *and* per-season size both arrive here. |
| `GET /series/{id}` | Single-series detail if needed. |
| `GET /episode?seriesId=` | Episode-level detail (only if/when episode-granularity is wanted). |
| `GET /episodefile?seriesId=` | Episode file paths/sizes (for future per-episode work or deletion). |
| `GET /diskspace` | Free space per mount. |

**`SeriesResource` fields Reaparr needs:** `id`, `title`, `year`, `tvdbId`, `imdbId`, `tmdbId`, `titleSlug`, `added`, `status`, `ended`, `seriesType` (standard/anime — relevant since anime is grabbed here), `tags`, and `statistics`.

**`SeriesStatisticsResource`:** `seasonCount` (→ FR-5), `episodeFileCount`, `episodeCount`, `totalEpisodeCount`, `sizeOnDisk` (→ FR-6, total series size), `percentOfEpisodes`.

**`seasons[].statistics` (`SeasonStatisticsResource`):** `seasonNumber`, `sizeOnDisk`, `episodeFileCount`, `percentOfEpisodes` — i.e. **per-season size is already in the `/series` payload**, no extra calls.

### A.3 Implication for the sync job

For the file-size + structure dimension, the entire MVP need is met by **two list calls** — `GET /series` (Sonarr) and `GET /movie` (Radarr) — on the sync interval. These join to Seerr requests and Tautulli watch history on `tmdbId`/`tvdbId`. No filesystem access, no pagination gymnastics, no per-title fan-out for the core view.

### A.4 Seerr (requests + requester identity)

Base: `http://<host>:5055/api/v1` · auth via `X-Api-Key` header.

| Endpoint | Use |
|---|---|
| `GET /request` | **Primary pull.** Paginated list of all requests. Params: `take`, `skip` (paging), `filter`, `sort` (`added`\|`modified`), `requestedBy`, `mediaType` (`movie`\|`tv`\|`all`). |
| `GET /request/{requestId}` | Single request detail if needed. |
| `GET /user` | User list — seeds the Seerr side of the Person identity map (§6). |

**`MediaRequest` fields Reaparr needs:** `id`, `status` (1 pending / 2 approved / 3 declined), `createdAt` (when requested), `requestedBy` → `User`, and `media` → `MediaInfo`. Paginate with `take`/`skip` until exhausted.

**`MediaInfo` (the title-join keys):** `tmdbId`, `tvdbId`, `mediaType` — these are the IDs that join a request to Sonarr/Radarr titles and to Tautulli watch history (§6.4).

**`User` (the identity keys):** `email`, `plexUsername`, `username`, `userType` — feed straight into SourceIdentity auto-match (§6.2). `requestedBy` gives "requested by" on the dashboard.

### A.5 Tautulli (watch history + watcher identity)

Base: `http://<host>:8181/api/v2` · auth **query-param** style: `?apikey=<key>&cmd=<command>&<params>`.

| Command | Use |
|---|---|
| `get_history` | **Primary pull.** Watch events, paginated (`length`, `start`; filter by `after`, `user_id`, `rating_key`, `grandparent_rating_key`). |
| `get_users` | User list — seeds the Tautulli side of the Person map. |
| `get_metadata` | `rating_key` → `guids` (`tmdb://`, `tvdb://`, `imdb://`) — maps a watched item to the external IDs for the title join. Cache results in SQLite. |
| `get_server_info` | Connection probe (§9.6). |

**`get_history` row fields Reaparr needs:** `date` / `stopped` (→ **last-watched** timestamp; max over a title's rows), `user_id` + `user` + `friendly_name` (→ **watched by**), `media_type` (`movie`\|`episode`), `rating_key` + `grandparent_rating_key` (the episode and its show), `watched_status` (0 / 0.5 / 1) and `percent_complete` (per-play progress).

**`get_users` fields:** `user_id` (stable numeric Plex id), `username` (Plex username — the §6.2 match key), `friendly_name` (display only — **never** a match key), `email`.

**Two cross-source computations to note for the plan:**

1. **Title join on the Tautulli side needs a hop.** History rows don't carry tmdb/tvdb directly — they carry `rating_key` / `grandparent_rating_key`. Resolve those to external IDs via `get_metadata` → `guids`, then join on `tmdbId`/`tvdbId` (cache the `rating_key → ids` mapping so it's one lookup per title, not per play).
2. **Series completion (the abandonment input, §8.5) is cross-source.** `completion = distinct episodes watched (Tautulli history, grouped by `grandparent_rating_key`, `watched_status = 1`) ÷ downloaded episode count (Sonarr `statistics.episodeFileCount`)`. Last-watched and the "watched by anyone" boolean come from history alone; only the *fraction* needs the Sonarr denominator.

### A.6 Plex *(Phase 1 only)*

OAuth/PIN login flow specifics, for when app auth lands (§9.4). Not part of MVP — no Plex integration is needed for data or identity.

### A.7 Full-sync shape (all four sources)

One daily pass (D-6): `GET /series` + `GET /movie` for structure/size; `GET /request` (paged) for requests/requesters; `get_history` (paged) + `get_users` + cached `get_metadata` for watches/watchers. Join everything on `tmdbId`/`tvdbId`, resolve people per §6.2, compute scores per §8.5, persist to SQLite.
