# feat: Spared titles — keep-forever exclusion from reaping

**Date:** 2026-07-01
**Type:** feat · **Depth:** Standard
**Origin:** `docs/brainstorms/2026-07-01-spared-titles-requirements.md`

---

## Summary

Add a **Spared** ("keep forever") mark the admin can put on any series or movie.
Spared titles sink to the bottom of the Series/Movies lists, visually muted, with the
Reap Score and staleness tier replaced by a **Spared** badge — still visible, never a
deletion candidate, and never raising a "Dormant / Very stale" flag. The score is still
computed and stored (just hidden), so unsparing restores the real ranking instantly.
Spared titles are excluded from the "Reclaimable" figure, with a companion "Spared: N ·
X GB" stat. The mark is a per-title flag that survives daily/manual re-syncs.

This is a per-title manual mark only — no rules engine, staying true to *glanceable,
not configurable* (origin: "Outside this product's identity").

---

## Problem frame

Intentional keeps (a comfort rewatch, a family keepsake) score purely on watch/request
signals today, so a much-loved-but-rarely-touched title surfaces at the top as
`100 · Dormant`, identical to genuine dead weight. The admin has no way to say "I know,
I'm keeping it," so the top of the list carries permanent false positives that erode
trust in the ranking. See origin Problem section.

---

## Requirements traceability

| Origin FR | Covered by |
|---|---|
| FR-S1 mark/unmark from detail modal | U2 (endpoint), U5 (modal toggle) |
| FR-S2 quick action from the row | U4 (row shield action) |
| FR-S3 pinned to bottom regardless of sort | U3 (sort), U4 (render) |
| FR-S4 muted row, Spared badge replaces score+tier | U4 |
| FR-S5 score still computed/stored, only hidden | U1 (flag is orthogonal to `score`), U4/U5 (display suppression) |
| FR-S6 excluded from Reclaimable; Spared space stat | U3 |
| FR-S7 persists across re-sync | U1 (flag preserved by `persistTitles`) |
| FR-S8 modal leads with Spared banner; score de-emphasized | U5 |

---

## Key technical decisions

- **KTD-1 — Store as a flag on `title`, mirroring `person.isMember`/`isHidden`.** Add
  `spared` (INTEGER 0/1) and `spared_at` (TEXT) columns to `title`
  (`server/db/schema.ts`). This is the established pattern in the codebase for
  admin-set boolean state and keeps sparing orthogonal to the computed `score` row.
- **KTD-2 — Persistence is free.** `persistTitles` in `server/sync/persist.ts` upserts
  title rows by `(source, source_id)` and its `values` object does not include the new
  columns, so an existing row's `spared`/`spared_at` are untouched on every sync
  (live and demo-refresh alike). No special-casing needed; U1 verifies this holds.
- **KTD-3 — Suppression is display-only.** The dashboard keeps returning each spared
  title's real `reapScore`/`tier` in the payload (so unsparing is instant and the modal
  can reveal it on request); the row component hides it. This satisfies FR-S5 without a
  recompute path.
- **KTD-4 — Bottom-pin in the query, not the client.** `getDashboard` sorts spared
  titles below all reapable ones regardless of the Score/Size toggle, so every consumer
  (and any future export) gets the same ordering. See origin FR-S3.
- **KTD-5 — Read-only preserved.** Sparing writes only to Reaparr's SQLite; no
  Sonarr/Radarr tag write-back (origin assumption; verified — `server/sources/` is
  pull-only, no write paths exist).
- **KTD-6 — Vocabulary.** State: **Spared**. Verb to set: **Spare**. Verb to clear:
  **Return to the reap**. Badge label: **Spared**. (origin: naming decision.)

---

## Implementation units

### U1. Data model — `spared` flag on `title`

**Goal:** Persist a per-title Spared flag that survives re-syncs.
**Requirements:** FR-S1, FR-S5, FR-S7.
**Dependencies:** none.
**Files:**
- `server/db/schema.ts` — add `spared` (integer, notNull, default 0) and `spared_at`
  (text, nullable) to the `title` table.
- `server/db/client.ts` — add both columns to `BOOTSTRAP_SQL`'s `title` DDL, and to the
  `ensureColumns` add-list (`['spared', 'INTEGER NOT NULL DEFAULT 0']`,
  `['spared_at', 'TEXT']`) so existing databases upgrade.

**Approach:** Mirror the `person.isMember`/`isHidden` shape exactly (integer 0/1). Do
**not** add the columns to the `values` object in `persistTitles`
(`server/sync/persist.ts`) — leaving them out is what preserves the flag across the
update-by-`(source, source_id)` upsert. Add a one-line comment there noting the
deliberate omission so a future edit doesn't "helpfully" include them.

**Patterns to follow:** `person` table columns and the `ensureColumns` block already in
`server/db/client.ts` (added for `title_slug`/`tautulli_key`).

**Test scenarios:**
- A fresh DB has `spared=0`, `spared_at=null` for every seeded title.
- Setting `spared=1` then running `persistBundle` again (re-sync) leaves `spared=1`
  intact (the update path must not reset it). *Integration — proves KTD-2.*
- `ensureColumns` on a DB created without the columns adds them without error and
  without dropping existing title rows.

**Verification:** `spared`/`spared_at` exist in both fresh-boot and pre-existing DBs; a
title's spared state is unchanged after a sync.

---

### U2. Spare / unspare endpoint + detail payload

**Goal:** Toggle a title's spared state, and expose it on the detail endpoint.
**Requirements:** FR-S1, FR-S8.
**Dependencies:** U1.
**Files:**
- `server/api/title/[id]/spare.post.ts` (new) — body `{ spared: boolean }`; sets
  `spared` and stamps/clears `spared_at`.
- `server/api/title/[id].get.ts` — add `spared` and `sparedAt` to the returned object.

**Approach:** Follow `server/api/people/member.post.ts` almost verbatim, keyed on the
`[id]` route param instead of a body `personId`: validate the id, `update(title)`
setting `spared` and `spared_at` (`new Date().toISOString()` when sparing, `null` when
unsparing), return `{ ok: true, spared }`. 404 on unknown id.

**Patterns to follow:** `server/api/people/member.post.ts`,
`server/api/people/hide.post.ts` (endpoint shape); the existing `[id].get.ts` for the
detail response contract.

**Test scenarios:**
- POST `{spared:true}` sets `spared=1` and a non-null `spared_at`; response
  `{ ok:true, spared:true }`.
- POST `{spared:false}` clears both (`spared=0`, `spared_at=null`).
- POST for a non-existent id returns a 404-style `{ ok:false }` without throwing.
- `GET /api/title/:id` reflects the new `spared` value after a toggle.

**Verification:** Toggling via the endpoint flips the DB flag and the detail payload.

---

### U3. Dashboard query & summary — bottom-pin + Reclaimable exclusion

**Goal:** Rank spared titles last and keep them out of the reclaim figure; surface a
Spared space stat.
**Requirements:** FR-S3, FR-S4 (data), FR-S6.
**Dependencies:** U1.
**Files:**
- `server/utils/dashboard.ts` — add `spared: boolean` to `DashboardRow`; select it from
  the title row; in the comparator, pin spared titles below non-spared ones **before**
  applying the score/size ordering (e.g. compare `Number(a.spared) - Number(b.spared)`
  first, then the existing sort). Keep `reapScore`/`tier` in the row (KTD-3).
- `server/api/dashboard.get.ts` — exclude spared rows from the `reclaimable` sum; add
  `sparedCount` and `sparedSize` (count and summed `sizeOnDisk` of spared rows) to the
  response.

**Approach:** Spared pinning is independent of the Score/Size toggle — both sorts push
spared to the bottom, ordered among themselves by the active key. `reclaimable` becomes
`rows.filter(r => !r.spared && r.reapScore >= 50)`. `totalSize` and `count` stay
inclusive (origin: only the reclaimable figure must exclude spared).

**Patterns to follow:** existing comparator and reduce logic in
`server/utils/dashboard.ts` / `server/api/dashboard.get.ts`.

**Test scenarios:**
- With one spared title that scores 100, sorting by Score still lists it **last**; every
  non-spared title precedes it.
- Sorting by Size also lists the spared title last (pin beats size).
- `reclaimable` excludes a spared title whose score ≥ 50; `sparedSize` equals that
  title's `sizeOnDisk`; `sparedCount` is 1.
- Unsparing returns the title to its score-ordered position and back into `reclaimable`.
  *Integration — covers FR-S5 round-trip.*

**Verification:** Spared rows always trail the list; reclaim math ignores them; the
summary reports Spared count/size.

---

### U4. Dashboard row rendering + quick shield action + Spared stat

**Goal:** Mute spared rows, replace their score/tier with a Spared badge, add a one-click
spare/unspare on the row, and show the Spared stat card.
**Requirements:** FR-S2, FR-S4.
**Dependencies:** U2, U3.
**Files:**
- `app/components/MediaTable.vue` — when `row.spared`: apply a muted row class, render a
  **Spared** badge (shield icon) in the score cell instead of the score + tier badges;
  add a quick shield toggle (an action affordance) that calls the spare endpoint with
  `@click.stop` so it does not open the detail modal. Emit an event
  (e.g. `@spared-changed`) so the parent can refresh.
- `app/pages/index.vue` — add a "Spared" summary card (`sparedCount` · `formatBytes(
  sparedSize)`) alongside the existing Titles/Total/Reclaimable cards; handle the
  refresh on `@spared-changed`.
- `app/utils/format.ts` — reuse `scoreColor`/`tierMeta`; no change expected (verify).

**Approach:** The row already emits `select` on click to open the modal; the shield
button must `@click.stop`. On toggle, POST to `/api/title/${id}/spare` then refresh the
dashboard fetch. Muted style = reduced opacity / `text-muted` on the row; the Spared
badge uses a shield icon and a neutral or primary variant (functional, not loud).

**Patterns to follow:** the existing score/tier cell in `MediaTable.vue`; the
`HealthStrip.vue` toast + refresh pattern for the POST-then-refresh flow; the summary
cards already in `app/pages/index.vue`.

**Test scenarios (component/behavioral — right-sized):**
- A spared row shows the **Spared** badge and no numeric score or tier chip.
- Clicking the row's shield toggle calls the spare endpoint and does **not** open the
  detail modal (`@click.stop` holds).
- Clicking elsewhere on a spared row still opens the detail modal.
- The Spared stat card renders `sparedCount` and `formatBytes(sparedSize)`.
- `Test expectation:` behavioral checks may be exercised via the running app in demo
  mode if no component-test harness exists (none present today) — note in the unit.

**Verification:** Spared rows read as muted "keepers" with no score noise; the shield
toggles state in place; the stat card reflects the spared set.

---

### U5. Detail modal — Spared banner, toggle, and score de-emphasis

**Goal:** Lead a spared title's modal with a Spared banner and a Return-to-the-reap
action; collapse the score breakdown behind a reveal.
**Requirements:** FR-S1, FR-S8.
**Dependencies:** U2.
**Files:**
- `app/components/TitleDetail.vue` — when `data.spared`: show a **Spared** banner at the
  top with a **Return to the reap** button; replace the header Reap Score badge with a
  Spared badge; hide the "How this score is built" breakdown behind a **"Show score
  anyway"** toggle (default collapsed). When not spared: show a **Spare** action
  (e.g. near the deep-link actions) and the breakdown as today. Toggling posts to
  `/api/title/${id}/spare` and refetches the detail (and signals the dashboard to
  refresh).

**Approach:** Reuse the existing `components`/`rawScore` computed for the breakdown; just
gate its visibility on a local `showScore` ref when spared. The Spare/unspare button
mirrors U4's call. Keep watch history, size, and facts always visible (origin FR-S8).

**Patterns to follow:** existing header + deep-link action rows in `TitleDetail.vue`; the
`$fetch` + refetch pattern already used for the detail load.

**Test scenarios:**
- Opening a spared title shows the Spared banner and a **Return to the reap** button;
  the score breakdown is not visible until "Show score anyway" is clicked.
- Opening a non-spared title shows a **Spare** action and the breakdown as before.
- Clicking Spare / Return-to-the-reap flips the state and the modal reflects it without a
  full reload.

**Verification:** The modal honors "don't notify me about its score" while keeping the
number one click away, and toggling works from the detail view.

---

### U6. Demo seed — pre-Spare one comfort title

**Goal:** Make the feature visible on first run without disturbing score assertions.
**Requirements:** FR-S4 (demonstration).
**Dependencies:** U1.
**Files:**
- `server/utils/demo-dataset.ts` and/or `server/utils/seed.ts` — after the demo bundle
  is persisted, set `spared=1` on one clearly-keep title (e.g. **"A Comedy"**, the
  finished favourite that scores 0). Apply it in the seed path so it is present on demo
  boot and demo-refresh.

**Approach:** Sparing does not change any computed score, so pre-sparing does not affect
the existing pipeline/score assertions. Pick a title whose "keep forever" framing is
intuitive (a finished, actively-watched comedy) to make the muting/badge behavior
self-explanatory in the demo.

**Patterns to follow:** the demo persistence flow in `server/utils/seed.ts`
(`seedDemo`).

**Test scenarios:**
- After a demo seed, exactly one title has `spared=1`; it renders at the bottom with a
  Spared badge and is absent from `reclaimable`.
- Existing score-by-title assertions (pipeline/score tests) are unchanged.

**Verification:** A fresh demo boot shows the Spared behavior immediately.

---

## Scope boundaries

**In scope:** per-title spare/unspare (row + modal), muted/score-suppressed rendering +
Spared badge, bottom-pin ordering, Reclaimable exclusion + Spared stat, persistence
across sync, one pre-spared demo title.

**Deferred to follow-up work:** bulk / multi-select spare; a dedicated **Spared** tab or
view; writing spared state back to Sonarr/Radarr as a tag; "Spare until <date>" or
spare-with-reason notes; annotating the "Titles" summary count with the spared subset.

**Outside this product's identity** (origin): any rules engine for auto-sparing (by tag,
genre, collection, age); per-user spared lists (no auth/multi-user in MVP).

---

## Risks & dependencies

- **Low risk overall** — additive flag + display/sort changes; the computed `score`
  pipeline is untouched.
- **Watch point:** a future edit to `persistTitles` that starts writing a full column
  set (or a `SELECT *`-style upsert) could clobber `spared` on sync. U1's comment and
  the re-sync persistence test guard against this.
- **Watch point:** the row shield action must `@click.stop`; without it, sparing would
  also open the modal. Covered by a U4 test scenario.

---

## Open questions (deferred to implementation)

- Exact muted styling for a spared row (opacity vs `text-muted` vs a subtle left border)
  — a small visual call for the implementer; functional, not fancy.
- Whether the Spared badge sits in the score cell or the reasons/why cell — implementer's
  layout call; the requirement is only that no score/tier shows.

---

## Verification (definition of done)

- A title can be spared/unspared from both the row shield and the detail modal; state
  persists across a **Sync now** and a demo refresh.
- Spared titles always trail the ranked list (either sort) with a Spared badge and no
  visible score or tier.
- The **Reclaimable** figure ignores spared titles; a **Spared: N · X GB** stat is shown.
- Unsparing returns a title to its correct ranked position with its real score.
- `npm test` green (new scenarios for U1–U3 included), `npm run typecheck` clean,
  `npm run build` succeeds.
