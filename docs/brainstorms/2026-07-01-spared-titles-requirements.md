# Spared titles — keep-forever exclusion from reaping

**Date:** 2026-07-01
**Status:** Requirements (ready for planning)
**Related:** `docs/reaparr-spec.md`, `docs/reaparr-technical-plan.md`

## Summary

Let the admin mark any series or movie as **Spared** — a keep-forever title the
Reaper never touches. Spared titles drop to the bottom of the Series/Movies lists,
de-emphasized, with their Reap Score and staleness tier replaced by a **Spared**
badge. They stay visible (so nothing is lost from view) but never read as deletion
candidates and never raise a "Dormant / Very stale" flag.

"Spared" is the chosen vocabulary — the direct antonym of *reap*, on-theme with the
harvest/Grim-Reaper metaphor. Verb: **Spare** / **Return to the reap** (unspare).

## Problem

Some titles are intentional keeps — a comfort rewatch, a family keepsake, a
reference copy. Today Reaparr scores them purely on watch/request signals, so a
much-loved-but-rarely-touched show surfaces at the very top as `100 · Dormant`,
exactly like genuine dead weight. The admin has no way to say "I know, and I'm
keeping it" — so the top of the list carries permanent false positives that erode
trust in the ranking. The current workaround is to mentally filter them out on every
visit, which defeats the glanceable purpose.

## Users

- **Admin (you)** — the only operator (MVP is unauthenticated, single-admin). Spares
  titles and reads the reaping list. Spared state is global to the instance, not
  per-person.

## Requirements

- **FR-S1** The admin can mark any series or movie as **Spared**, and later **Return
  it to the reap** (unspare), from the title detail modal.
- **FR-S2** A quick Spare / unspare action is also available directly on the
  dashboard row (a shield/scythe-off affordance), without opening the modal.
- **FR-S3** Spared titles are pinned to the **bottom** of the Series and Movies
  lists, below every reapable title, regardless of the active Score/Size sort. Among
  themselves they can order by title or size (planning's call).
- **FR-S4** A spared row is **visually muted** and shows a **Spared** badge in place
  of the Reap Score number and the tier chip. No staleness state (Stale / Very stale
  / Dormant) is shown for it.
- **FR-S5** The Reap Score, components, and tier are still **computed and stored** for
  spared titles — only hidden in the UI. Unsparing restores the real score instantly,
  with no re-sync required.
- **FR-S6** Spared titles are **excluded from the "Reclaimable (score ≥ 50)"** summary
  figure. A companion **"Spared: N · X GB"** stat shows the space they hold, so the
  reclaim picture stays honest.
- **FR-S7** The Spared flag **survives daily and manual re-syncs** — it is keyed to the
  title's stable source identity, not rebuilt from source data.
- **FR-S8** In the detail modal, a spared title leads with a **Spared** banner and
  offers **Return to the reap**. The score breakdown is not shown prominently (honoring
  "don't notify me about its score/state"); its watch history, size, and facts remain
  fully visible. Whether the breakdown is fully hidden or available behind a
  "show score anyway" toggle is a small UX call left to planning.

## Behavior notes

- **Read-only preserved.** Sparing is a Reaparr-local flag. It does **not** write back
  to Sonarr/Radarr (no tag creation), consistent with the MVP read-only stance.
- **Score sort / size sort** reorder only the reapable set; spared titles always sink
  below them either way.
- **Counts.** The "Titles" count and total-size stat may stay inclusive; only the
  *reclaimable* figure must exclude spared titles (that's the one that implies "act on
  this"). Planning can decide whether "Titles" shows e.g. "6 (2 spared)".

## Scope boundaries

**In scope**
- Per-title spare/unspare (series and movies), from row and detail modal.
- Bottom-pinned, muted, score-suppressed rendering + Spared badge.
- Exclusion from the reclaimable figure; a Spared space stat.
- Persistence across syncs.

**Deferred (later, not now)**
- Bulk spare / multi-select.
- A dedicated **Spared** tab/view collecting everything kept forever.
- Writing the spared state back to Sonarr/Radarr as a tag.
- "Spare until <date>" (temporary reprieve) or spare-with-reason notes.
- Hide-with-toggle placement (chosen against in favor of always-visible bottom pin;
  revisit only if the bottom list gets noisy).

**Outside this product's identity**
- Any **rules engine** for auto-sparing (by tag, genre, collection, age…). Sparing is
  a deliberate manual mark only — this stays true to *glanceable, not configurable*.
- Per-user spared lists (no auth / multi-user in MVP).

## Success criteria

- A spared title never appears among the top-ranked candidates; it sits at the bottom
  with a **Spared** badge and no visible score or tier.
- Spare and unspare are each a single click and update the list immediately.
- The Spared state persists across a **Sync now** and the daily sync.
- The **Reclaimable** total ignores spared titles; a Spared space figure is shown.
- Unsparing a title returns it to its correct ranked position with its real score.

## Assumptions & open questions

- **Assumption:** Reaparr stays read-only — no Sonarr/Radarr tag write-back for spared
  state. (Verified against current codebase: no delete/tag write paths exist; sources
  are pull-only in `server/sources/`.)
- **Assumption:** Spared is a boolean flag on the title, persisted like `tautulli_key`
  (keyed to `source` + `source_id`, so it survives the sync rebuild in
  `server/sync/persist.ts`). Exact column/shape is planning's decision.
- **Open (small):** modal treatment of the score for a spared title — fully hidden vs
  "show score anyway" toggle (FR-S8).
- **Open (small):** whether the "Titles" summary count annotates the spared subset.
