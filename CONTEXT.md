# Reaparr — Domain Context

Glossary of the functional vocabulary. Terms here are neutral and load-bearing across schema, API,
and code. The Death/Pratchett **voice** is a frontend display concern only; where a term has a voice
label, it is noted as a display alias and never appears in data, schema, or identifiers.

## Identity & lifecycle

- **Title** — a series or movie tracked from Sonarr/Radarr. Identity is keyed on the **external
  stable id** (`tmdb_id` for movies, `tvdb_id` for series), not the internal row id or the *arr entry
  id. The external id survives removal and return.
- **Episode** — one life of a title. `episode` starts at 1 and increments on resurrection. Score and
  history belong to the current episode; scores are never averaged across lives.
- **Tombstone** — a removed title's row, retained (not deleted) with `removed_at` set so its history
  survives and a return can match on the external id.
- **Resurrection** — a tombstoned title reappearing (matched on external id), reactivated as a new
  episode with a fresh score. A first-class logged transition.

## State machine (functional state → voice label)

- **eligible** *(Eligible)* — in the candidate pool with a live Reap Score.
- **scheduled** *(The Sands)* — the operator scheduled it; the grace clock runs
  (`due_at = scheduled_at + grace_days`).
- **appealed** *(Appeal Raised)* — a member appealed; floated to the top of the Sands, not a separate
  list. Blocks the Appointed Hour flip until resolved.
- **due** *(The Appointed Hour)* — grace elapsed with no open appeal; the actionable list.
- **removed** *(Departed)* — removal intent recorded; awaiting sync confirmation, then the episode closes.
- **Reprieve** — sparing a title *within* the workflow: a transition back to `eligible`, captured as
  a logged event (not a persistent state). No cool-off in v1.

## Actors & records

- **Person** — the canonical human; linked to Seerr/Tautulli (and, in M2, Plex) via
  `source_identity`. No admin/member role distinction is stored.
- **Member** — a person with `is_member = 1`; the notification/appeal audience (all members in v1).
- **Operator** — the person running Reaparr; in M1 there is no session identity, so the operator
  drives every action and records appeals on a member's behalf.
- **Actor (of a transition)** — either a person (`actor_person_id`) or the system
  (`actor_system` = `sync` | `system`); exactly one is populated.
- **Transition log** (`title_transition`) — append-only ledger; one row per state change. Explains
  how a title reached its current state. Never updated or deleted.
- **Notification ledger** (`reaping_notification`) — what was sent, to whom, per event. Separate from
  the transition log; the two reference each other, they do not merge.

## Adjacent terms (pre-existing, kept distinct)

- **Reap Score / tier** — the 0–100 staleness score and its tier (fresh/stale/very_stale/dormant).
- **Spared** — the operator's keep-forever exclusion (`spared`/`spared_at`). A **separate** function
  from reprieve: granting an appeal never sets `spared`.
- **Connected member** — a member linked to a title by a Seerr request or a Tautulli watch. Not the
  audience gate in v1 (all members are), but useful display context.
