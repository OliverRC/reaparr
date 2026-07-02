# ADR-0004 — Notification audience: all members, behind a Notifier interface

**Status:** Accepted (2026-07-02) · Milestone M1

## Context

The workflow must tell members a title is scheduled and let them appeal. Two questions forked the
design: *who* is the audience (all members vs only members connected to the title), and *how* the
channel abstraction avoids baking in email assumptions when Discord arrives later.

## Decision

- **Audience = all members.** Every `is_member` person is notified and may appeal any scheduled title;
  the **operator is included** (they can unset their own `is_member`). Recipient resolution is the
  member list with a resolvable email via `source_identity` — no requester/watcher join needed.
- **`Notifier` interface from day one.** M1 ships `EmailNotifier` (per-recipient fan-out, each email
  carrying that person's deep link). A **broadcast** shape (Discord, single webhook) is defined but
  deferred to M2 — the interface must not assume "notify" means "loop over people".
- **Events:** `scheduled`, `reminder` (opt-in per-schedule, default off), `reprieved` (manual grant +
  auto-reprieve), `departed`. **Departed always notifies** — admin-marked or sync-confirmed, on-time
  or early/out-of-band; one rule, no special case.
- Every send is logged to `reaping_notification` for idempotency and visibility ("3 notified").
- Email transport sits behind the notifier with a log-only fallback so mail is never load-bearing.

## Consequences

- Simple recipient resolution; a member without a resolvable email is silently skipped.
- Because a single broadcast message cannot carry per-person links, member self-service **objection
  stays email-only** and is deferred to M2 along with the Discord broadcast.
- Reminder is a per-schedule `send_reminder` flag, not a global setting.
