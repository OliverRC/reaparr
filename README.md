# Reaparr

A read-only dashboard that surfaces stale, unwatched media on your *arr stack as
**priority-ranked deletion candidates** — and shows how much space you'd reclaim.

It consolidates four sources into one view per title:

| Source | Provides |
|---|---|
| **Sonarr** | Series structure + size on disk |
| **Radarr** | Movie files + size on disk |
| **Seerr** | Who requested what, and when |
| **Tautulli** | Who actually watched what, and when |

Each title gets an opinionated **Reap Score** (0–100, higher = stronger candidate),
with size shown *beside* it as the payoff — never folded into the score. People are
resolved into a **single canonical person** across Seerr and Tautulli automatically.

> MVP is **read-only**: it ranks and tracks, it does not delete. No auth (trusted LAN).

## Quick start

```bash
npm install                 # builds the better-sqlite3 native module
REAPARR_DEMO=1 npm run dev   # boot fully populated with demo data, no sources needed
```

Open the printed URL. The dashboard renders ranked Series / Movies, the **People**
page shows identity reconciliation, and **Settings → Connections** configures sources.

### Demo mode

`REAPARR_DEMO=1` seeds a realistic fake picture (6 series, 4 movies, requests,
watch history, pre-mapped + conflicting people) so every view works end-to-end with
zero configuration. **Sync now** refreshes it.

### Mock source server

Exercises the real adapter + sync code paths (all four auth shapes) with no credentials:

```bash
npm run mock-server          # serves the demo dataset at each source's real API paths
```

Then in Settings, point each connection's Base URL at `http://localhost:8900` with any
non-empty key, Test, enable, and Sync.

## The Reap Score (v1)

`raw = Staleness(0–50) + Abandonment(0–30) + Request-miss(0|20)`, then a grace factor
ramps brand-new content in over ~30 days. Driven by watch + request signals only:

- **Staleness** — stepped at 3 / 6 / 12 months idle (*Stale → Very stale → Dormant*).
- **Abandonment** — `30 × (1 − completion)`; series completion = episodes watched ÷ on disk.
- **Request-miss** — requested but never watched by anyone → +20.

Size is **never** in the score (it's an independently-sortable companion column).
The only two knobs (Settings → Scoring): the staleness tiers and the grace period.

## Tests & validation

```bash
npm test          # 36 unit + integration tests (scoring, identity, join, full pipeline, mock sync)
npm run typecheck
npm run build
```

The build is **self-validating** (spec §12.5): unit tests lock the scoring formula and
identity rules, an end-to-end test runs the demo dataset through the full pipeline with
known expected scores, and another runs a complete sync against the mock server. Only the
final "enter real API keys + one live sync" step needs you.

## Deployment (Docker on Unraid)

```bash
docker build -t reaparr .
docker run -d -p 3000:3000 -v /mnt/user/appdata/reaparr:/app/data reaparr
```

The SQLite database lives in the mounted `/app/data` volume and persists across updates.
Configure sources via the Settings UI (or seed with `SONARR_URL`/`SONARR_API_KEY`/… env vars).

## Architecture

- **Nuxt 4 / Vue 3 + NuxtUI**, Nitro `node-server` preset.
- **SQLite** via Drizzle ORM + better-sqlite3, on a volume-mounted file.
- **Daily sync** (Nitro scheduled task) + manual **Sync now**; the dashboard reads the
  local cache, never the live sources.
- Pure transforms (`server/sync/score.ts`, `identity.ts`, `join.ts`) are fully unit-tested.

See [`docs/reaparr-spec.md`](docs/reaparr-spec.md) and
[`docs/reaparr-technical-plan.md`](docs/reaparr-technical-plan.md).
