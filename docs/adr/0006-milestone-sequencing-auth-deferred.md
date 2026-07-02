# ADR-0006 — Milestone sequencing: operator-driven M1, Plex auth deferred to M2

**Status:** Accepted (2026-07-02)

## Context

The spec locks "everyone must authenticate" via Sign in with Plex, resolving to an existing Person.
But this is greenfield: there is no auth, no session, no `person_id` resolution from a login, and no
`plex` `source_identity` — today `source_identity.source` is only `seerr`/`tautulli`, and persons are
matched on Plex username/email across those two. Building Plex OAuth is a large piece of work, and
member self-service appeal depends on it.

## Decision

Sequence the work:

- **M1 (this plan) ships operator-driven, with no auth.** The operator drives every transition and
  **records appeals on a member's behalf**. The full state machine, scheduling/clock, removal
  reconciliation, email notifications, and auto-reprieve-on-watch all land here.
- **M2 (separate plan) adds authentication.** Sign in with Plex (a new `plex` `source_identity`
  matched to an existing person by username/email), session → `person_id`, member **self-service**
  appeal via the emailed deep link (a plain deep link — the link says *which* title, the session says
  *who*), and the Discord **broadcast** notifier.
- **Authorization stays deferred** entirely — once authenticated (in M2), everyone can do everything;
  roles arrive only the day a second person needs scoped access.

## Consequences

- Value ships without waiting on the large greenfield auth build.
- The emailed "speak for it" link lands on a read-only appeal surface until M2 wires self-service.
- The `plex` source and session→person resolution are net-new in M2; a break-glass local-account
  fallback (as Overseerr keeps) is noted for when plex.tv is unreachable, not built.
