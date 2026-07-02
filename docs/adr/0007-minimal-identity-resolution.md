# ADR-0007 — Minimal identity resolution: email-only clustering, no manual reconciliation

**Status:** Accepted (2026-07-02) · Milestone M1 · Narrows the identity-reconciliation surface of spec FR-15 and D-5/§6.2

## Context

The person register (`person` / `source_identity`) is resolved every sync inside
`persistPeople` (`server/sync/persist.ts`). The spec (§6.2, D-5) matches on **email OR Plex username**,
flags disagreements as `needs_review`, and offers a reconciliation UI to **confirm / merge / split /
override** the residue (FR-15). That machinery is the most complex, least-tested code in the pipeline:
person-mutation logic is spread across `persistPeople` plus five `people/*` handlers, the "manual
overrides survive a re-sync" invariant has no single home, and `persistPeople` does a disruptive
wipe-and-rebuild of `source_identity` every run. No test covers merge/split/confirm.

Two facts make this machinery disproportionate:

- **Identity is display-only.** The Reap Score never depends on identity (§6 footnote); it only asks
  "did *anyone* watch this?". A wrong or missing person link mislabels a "requested by" / "watched by"
  name — it can never mis-score a candidate.
- **The Plex anchor makes auto-match strong.** Seerr and Tautulli users are Plex accounts registered
  with an email, so email is a stable, reliable join. Manual merge/split is a rare, low-stakes edge.

## Decision

Keep identity resolution **minimal**. The register becomes a deep **reconciliation module** owning the
person tables behind intent verbs; the resolution rules collapse:

- **Cluster on normalized email only** (case-insensitive, trimmed). Two identities sharing an email are
  one Person; an identity with no email is its own single-source Person. Plex `username` is still
  *stored* (display, and potential M2 login matching — see interactions) but is **not** a clustering key.
- **No conflicts, no `needs_review`, no `confirmed`.** Email-only matching has no OR-disagreement to
  detect, so the whole review state disappears. `person.match_status` is **retired** (no longer produced
  or read).
- **No manual `merge` / `split` / `confirm`.** Auto-match is deterministic, so nothing changes a cluster
  between syncs; there is no re-grouping to override. These verbs and their handlers are removed.
- **Custom display names are kept** as the one persisted override. `person.custom_name` (nullable) is
  admin-set via `setDisplayName`; `person.display_name` stays the source-derived name
  (friendly_name → username → email local-part), refreshed every sync. Read side shows
  `custom_name ?? display_name`.
- **`reconcile` upserts, it does not wipe.** Persons are keyed by `match_key` (normalized email, or the
  lone `source:source_user_id` for no-email single-source people). Upsert `person` by `match_key`
  (preserving `id`, `is_member`, `is_hidden`, `custom_name`; refreshing `display_name`); upsert
  `source_identity` by `(source, source_user_id)`; delete identities whose source user vanished and
  person rows left owning none. Because rows are preserved by `match_key`, flags and the custom name
  ride along for free — no re-application dance. Each verb is atomic (`db.transaction`).

**Verb surface:** `reconcile`, `setMember`, `setHidden`, `setDisplayName`. (Gone: `merge`, `split`,
`confirm`.)

## Consequences

- The "overrides survive re-sync" invariant becomes trivially true (rows are preserved), and
  `reconcile` + the setters become directly unit-testable against a temp DB — the previously untestable
  merge/split/confirm surface is gone rather than left untested.
- `server/sync/identity.ts` collapses from union-find + conflict detection to group-by-email.
- **Accepted edge:** a person changing their Plex email (rare) yields a new `match_key`, so their flags
  and `custom_name` reset to defaults. Judged acceptable given frequency and display-only stakes; the
  alternative (reuse person rows by identity-key overlap) was considered and rejected as
  disproportionate.
- Frontend follow-on: the People page loses needs-review sorting/badges; `people/index.get` loses its
  `needsReview` count; a `setDisplayName` endpoint is added.

## Interactions

- **Supersedes** the merge/split/confirm portion of spec FR-15 and the "OR Plex username" clause of
  D-5/§6.2 for **sync-time clustering**. The reconciliation UI shrinks to flags + custom names.
- **ADR-0006 (M2 auth)** resolves a Plex login to an existing Person by username/email. That is a
  **login-time resolution**, distinct from sync-time clustering, and may still consult `username`
  (still stored). This ADR does not constrain M2's login match; M2 planning should note that sync no
  longer clusters on username.
- **ADR-0004** resolves notification recipients via a member's resolvable email in `source_identity` —
  unaffected; email remains the identity anchor.
- Independent of **ADR-0002** (title tombstone/episode reconcile), which governs the `title` table, not
  the person register.
