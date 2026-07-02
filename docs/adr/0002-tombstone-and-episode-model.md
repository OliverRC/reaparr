# ADR-0002 — Tombstone table & episode-scoped resurrection

**Status:** Accepted (2026-07-02) · Milestone M1 · Supersedes the current `persistTitles` hard-delete reconcile

## Context

§8 of the feature spec requires that removal *tombstones* a title (never deletes), that history is
retained indefinitely, and that a returning title matches on its external id to reopen a new life.
But `persistTitles()` in `server/sync/persist.ts` today builds a `keep` set from the latest
Sonarr/Radarr pull and **hard-deletes** any title not in it, cascading away `season`,
`watched_item`, `title_watcher`, and `score`. Worse, a *arr fetch that throws leaves its list empty
while the run still persists, so a transient failure would delete every title for that source.

## Decision

Make `title` a **soft-delete / tombstone table**:

- The sync stops hard-deleting. A title absent from a source's pull is soft-closed — `state='removed'`,
  `removed_at` set, `reason='sync_confirmed_removed'` — and its row and child rows are **retained**.
- **Fetch-guard:** removals are reconciled only for sources whose fetch **succeeded** this run. A
  failed or empty source never triggers a removal.
- **Resurrection:** a re-added title matches a tombstoned row on external id (`tmdb_id`/`tvdb_id`),
  reactivates it, increments `episode`, clears `removed_at`, returns it to `eligible`, and logs a
  `resurrected` transition (metadata: seerr request id, requested-by person, new *arr id). The score
  is recomputed fresh for the new episode.

## Consequences

- Enables retained history and external-id resurrection (episode-scoped model).
- **Fixes a latent mass-wipe bug** — a failed *arr fetch can no longer delete that source's titles.
- The FK `onDelete: cascade` on child tables is no longer reached by normal sync; pruning ancient
  closed episodes becomes a separate, explicit, future path (never the identity or recent history).
- Title identity is permanent; each life is an episode with its own start, end, and score history.
