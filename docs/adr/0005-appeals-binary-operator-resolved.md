# ADR-0005 — Appeals: binary, operator-resolved, sparing kept separate

**Status:** Accepted (2026-07-02) · Milestone M1

## Context

The spec left the appeal shape open: reason codes, free-text notes, whether an unresolved appeal
blocks removal, and whether a granted "keep permanently" should create a real exclusion. It also
risked overlapping with the existing `spared` keep-forever flag.

## Decision

- **An appeal is binary** — a member appeals or doesn't. **No reason codes**, no "why" menu, no
  free-text note in v1. Raising an appeal moves the title to `appealed` (floated to the top of the
  Sands).
- **An unresolved appeal blocks** the Appointed Hour flip — a `scheduled` title in `appealed` does not
  advance to `due` until resolved. This honors "appeal, not veto" (the admin still decides) while
  guaranteeing no appealed title is actioned unheard.
- **Resolution is binary** — the admin **accepts** (→ reprieve → `eligible`, logged `appeal_granted`)
  or **denies** (→ `scheduled`, logged `appeal_denied`, deny email to the appellant). No cool-off in
  v1, so a reprieved title re-enters the pool immediately.
- **Sparing is a separate function.** Granting an appeal **never** sets `spared`. Permanent keep
  remains the existing Spare action; `spared`/`spared_at` are untouched by this workflow.
- **Auto-reprieve on watch:** any play (a `title_watcher`/`watched_item` `last_watched_at`) inside the
  grace window auto-reprieves the title — watching is the strongest possible objection, made without
  lifting a finger — logged `auto_reprieve_watched`, actor=system.

## Consequences

- Minimal appeal UX and no parallel exclusion machinery.
- One member cannot unilaterally keep a title alive forever — an appeal is an appeal to admin
  authority, granted or denied.
- Multiple appellants per title are allowed (each logged); withdraw returns the title to `scheduled`.
