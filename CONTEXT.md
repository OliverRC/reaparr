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
  `source_identity`. No admin/member role distinction is stored. A Person's display name is
  `custom_name ?? display_name` — see Reconciliation.
- **Member** — a person with `is_member = 1`; the notification/appeal audience (all members in v1).
- **Operator** — the person running Reaparr; in M1 there is no session identity, so the operator
  drives every action and records appeals on a member's behalf.
- **Actor (of a transition)** — either a person (`actor_person_id`) or the system
  (`actor_system` = `sync` reconciliation | `system` automated | `operator` a human operator action
  with no captured session, M1); exactly one is populated.
- **Transition log** (`title_transition`) — append-only ledger; one row per state change. Explains
  how a title reached its current state. Never updated or deleted.
- **Notification ledger** (`reaping_notification`) — what was sent, to whom, per event. Separate from
  the transition log; the two reference each other, they do not merge.

## Reconciliation (the person register)

See [ADR-0007](docs/adr/0007-minimal-identity-resolution.md). Identity is **display-only** — it never
moves the Reap Score — so resolution is kept minimal.

- **Reconciliation** — resolving Seerr/Tautulli source accounts into canonical Persons each sync.
  Owned by the **reconciliation module** (the deep module fronting the `person` / `source_identity`
  tables) behind intent verbs: `reconcile`, `setMember`, `setHidden`, `setDisplayName`.
- **`reconcile`** — the sync-time pass: cluster identities → upsert the register → delete missing.
  Deterministic and atomic. Upsert, never wipe-and-rebuild.
- **SourceIdentity** — one linked source account (`source` = `seerr` | `tautulli`, keyed by
  `(source, source_user_id)`). Carries `email`, `username` (Plex username), `friendly_name`.
- **Email clustering** — the **only** match rule: identities sharing a normalized email are one Person;
  no-email identities stand alone. Plex `username` is stored (display; potential M2 login match) but is
  **not** a clustering key.
- **`match_key`** — a Person's stable natural key across syncs: normalized email, or the lone
  `source:source_user_id` for a no-email single-source Person. Drives the `reconcile` upsert.
- **`display_name`** — the source-derived name (friendly_name → username → email local-part), refreshed
  every sync. **`custom_name`** — the admin-set override; the one persisted name decision. Read side
  shows `custom_name ?? display_name`.
- **Retired:** `match_status` (`auto`/`confirmed`/`needs_review`) and manual **merge / split / confirm**.
  Email-only matching produces no conflicts, so there is no review state and no manual re-grouping
  (ADR-0007).

## Adjacent terms (pre-existing, kept distinct)

- **Reap Score / tier** — the 0–100 staleness score and its tier (fresh/stale/very_stale/dormant).
- **Spared** — the operator's keep-forever exclusion (`spared`/`spared_at`). A **separate** function
  from reprieve: granting an appeal never sets `spared`.
- **Connected member** — a member linked to a title by a Seerr request or a Tautulli watch. Not the
  audience gate in v1 (all members are), but useful display context.
