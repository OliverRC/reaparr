# ADR-0003 — Append-only transition log & actor model

**Status:** Accepted (2026-07-02) · Milestone M1

## Context

We need to answer "how did this title get here?" by replay, keep an auditable record separate from
what we *sent* to members, and record *who* caused each change without conflating identity with
authorization (authz is deferred — ADR-0006).

## Decision

All state changes flow through a single `applyTransition()` in `server/reaping/stateMachine.ts`,
which in one transaction: validates the transition against an allowed-transitions map, inserts an
append-only `title_transition` row (stamping the current `episode` and a `reason` enum, not prose),
and updates the denormalized `title.state` (+ clock/`removed_at`/`episode`).

- **Actor model:** exactly one of `actor_person_id` (nullable FK, human actions) or `actor_system`
  (`sync` | `system`, non-human actions) is populated — enforced at the application layer.
- The transition log is **separate from** the `reaping_notification` ledger (ADR-0004). Transitions
  = what happened to the title; notifications = what we sent, to whom. They reference each other;
  they do not merge.
- The log is never updated or deleted.

## Consequences

- Current state is replayable and always consistent with the denormalized column (single write path).
- Referential integrity holds on the common (person) case; the system enum covers sync/auto actions.
- The log records identity, not authorization — with M1's operator-driven model every human actor is
  the operator acting on someone's behalf; real authz checks arrive with M2 auth.
