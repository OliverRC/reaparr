# ADR-0001 — Title lifecycle state machine

**Status:** Accepted (2026-07-02) · Milestone M1

## Context

Reaparr ranks stale titles but has no supported lifecycle from "flagged" to "removed". The Reaping
Workflow needs named states, and the frontend leans on Death's voice — which must not leak into the
schema, per CLAUDE.md.

## Decision

Model reaping as five **functional** states — `eligible`, `scheduled`, `appealed`, `due`, `removed`
— with `reprieve` and `resurrected` modelled as **transitions**, not persistent states. Store a
denormalized `title.state` (fast read) equal to the latest transition's `to_state` (see ADR-0003).
Voice labels (Eligible / The Sands / Appeal Raised / The Appointed Hour / Departed) live in a
frontend copy map keyed by the functional enum; they are never stored or transmitted.

`reprieved` is not a state: sparing a title within the workflow transitions it back to `eligible`
and is captured only as a log row. There is no cool-off in v1 (ADR-0005).

## Consequences

- Reads are cheap (a single column); history explains how a title got there (ADR-0003).
- A plain-language toggle, accessibility mode, or localization is just a second copy map — the
  backend is untouched.
- `appealed` is a state within the Sands, not a third list; the UI floats it to the top.
