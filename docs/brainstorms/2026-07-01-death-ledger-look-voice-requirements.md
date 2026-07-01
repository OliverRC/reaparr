---
date: 2026-07-01
topic: death-ledger-look-voice
---

# Death's Ledger — Look & Voice

## Summary

Re-skin the live app into its "Death's ledger" identity by translating the `design/` mockup's inspiration into Nuxt UI's own theming: a cyan "eye" primary accent, dark-native, a life-state palette wired to the Reap tiers, and three type roles (serif · sans · mono) loaded via `@nuxt/fonts`. Death's voice — Terry Pratchett's Death, dry and deadpan — is hardcoded on headlines and empty/loading states through one reusable serif small-caps treatment. The dashboard proves the identity end-to-end; other screens inherit the global theme.

## Problem Frame

The `design/` folder holds a fully-authored identity — dark canvas, a cyan "Death's eye" accent, ember/candle/sage life-states, a literary serif voice, carved-stone density — and its own comments name it "Death's ledger." The live app carries none of it: it is default Nuxt UI (`primary: green`, `neutral: slate`, Public Sans), visually indistinguishable from any starter. The product's whole reason to exist is opinionated — it ranks media for the reaping — but the interface doesn't yet say so. The gap is both visual (the palette, type, density) and verbal (Death's voice, the life-state language). Closing it is what makes the app unmistakably this product.

## Key Decisions

- **Translate, don't lift.** `design/` is inspiration only. The identity is expressed entirely in Nuxt UI tokens — `ui.colors` in `app/app.config.ts` and `@theme` in `app/assets/css/main.css` — never the mockup's `--void/--eye/--ember` layer, markup, or class names. This is the standing rule in `CLAUDE.md`.
- **Cyan primary; green becomes "alive."** Cyan ("eye") takes over as the app-wide accent, and green demotes to `success`/alive. The accent flips across every component currently reading green — the member star, dashboard sort buttons, the merge bar — which is intended.
- **The life-state palette overloads Nuxt UI's semantic colors.** `success`/`warning`/`error` carry life meaning *and* their generic meaning at once: a success toast also reads as "alive," a warning as "fading." Accepted — the overload reinforces the theme rather than fighting it.
- **Death's voice is Pratchett, not gothic.** Dry, deadpan, quietly amused — wry rather than grim — correcting the mockup's more solemn "carved stone / Death does not hurry" register. Small caps, no quotation marks, on headlines and empty states only. This follows `CLAUDE.md`.
- **Serif carries the voice.** Serif small-caps over mono monotone — the literary, weighty read the mockup uses, chosen over the machine-deadpan alternative `CLAUDE.md` also permits.
- **Voice is fixed identity, not adaptable.** A central plain/death voice map and a full `@nuxtjs/i18n` locale were both considered and dropped — the first as unneeded indirection, the second as disproportionate infrastructure for a single-admin tool. The voice is the product; it does not get a toggle.

## Requirements

**Theme foundation**

- R1. The app is dark-native — dark by default via Nuxt UI's color mode. A light mode is not delivered this effort.
- R2. All visual identity lives in Nuxt UI tokens (`app/app.config.ts` `ui.colors` and `@theme` in `app/assets/css/main.css`); nothing is copied from `design/`.
- R3. Fonts load through `@nuxt/fonts`: a serif display family, a grotesk sans, and a monospace.
- R4. Default density and shape lean "dense, tight, carved" — tighter radii and denser spacing than Nuxt UI defaults — tuned through the theme.

**Color & life-states**

- R5. `primary` is cyan ("eye"), replacing green as the accent everywhere.
- R6. The Reap tiers map to a life-state palette expressed through Nuxt UI semantic colors, per the table below. Exact tier-to-state thresholds are settled in planning.

| Life-state | Reap tier(s) | Nuxt UI color | Hue |
|---|---|---|---|
| Alive | `fresh` | `success` | green (sage) |
| Fading | `stale` | `warning` | amber (candle) |
| Condemned | `very_stale`, `dormant` | `error` | red (ember) |
| Spared | spared flag (any score) | `primary` | cyan (eye) |

**Typography roles**

- R7. Three type roles: serif for display/headlines and Death's voice; sans for all functional UI; mono for data and numbers (`tabular-nums`), rationed rather than used broadly.

**Voice**

- R8. Death's voice is one reusable treatment — serif, uppercase/small-caps, letter-spaced, no quotation marks — applied only to headlines and empty/loading states.
- R9. Voice copy follows Pratchett's Death: dry, deadpan, wry not grim. Functional UI (labels, buttons, form fields) stays plain sans and never speaks in Death's voice.
- R10. The voice is not user-configurable — no toggle, no i18n locale.

**Dashboard (the proof)**

- R11. The dashboard wears the full identity end-to-end: dark canvas, cyan accent, life-state coloring on titles and scores, the three type roles, and the carved density.
- R12. Every dashboard empty state and loading state speaks in Death's voice.

**Inheritance**

- R13. People and Settings inherit the global theme, fonts, and the voice treatment automatically, but receive no bespoke styling pass this effort.

## Acceptance Examples

- AE1. Covers R1. **Given** a fresh visitor with no stored color-mode preference, **when** the app first loads, **then** it renders dark.
- AE2. Covers R6, R11. **Given** the dashboard, **when** a title is in the `fresh` tier it shows the alive/`success` (green) treatment, a `dormant` title shows condemned/`error` (red), and a spared title shows `primary` (cyan) regardless of its score.
- AE3. Covers R8, R12. **Given** the dashboard with zero titles, **when** it renders the empty state, **then** the headline is in Death's voice — serif small-caps, no quotation marks — e.g. `THERE IS NOTHING HERE TO REAP.`
- AE4. Covers R9. **Given** any functional control (a "Sync now" button, a form label), **when** it renders, **then** it uses plain sans, never Death's voice.

## Scope Boundaries

**Deferred for later**

- The Reap Queue / active-reaping workflow the mockup hints at (`ReapQueueScreen`) — this effort is look and voice, not new features.
- A bespoke styling pass for People and Settings — they inherit the global theme only.
- A plain-voice toggle or `@nuxtjs/i18n` locale — considered and dropped; revisit only on real demand.
- Light mode.

## Dependencies / Assumptions

- `@nuxt/fonts` is net-new — not currently in `package.json` modules.
- Dark-native default relies on Nuxt UI's bundled color-mode support.
- Fonts are sourced from Google Fonts by name (net-new brand, no self-hosted binaries); assume availability and licensing are acceptable.
- Current theme baseline to be replaced/extended: `app/app.config.ts` sets `primary: green` / `neutral: slate`; `app/assets/css/main.css` defines a custom green scale and Public Sans.

## Outstanding Questions

**Deferred to planning**

- Exact tier-to-life-state thresholds — which tiers count as condemned vs fading, and the score cutoffs behind them.
- Exact font families — EB Garamond / Hanken Grotesk / JetBrains Mono as the inspiration defaults, or nearest suitable substitutes.
- Whether the carved density (R4) is a global theme change or scoped to the dashboard this pass.

## Sources / Research

- `design/Reaparr App (standalone).html` — the mockup and its embedded design-philosophy comments (life-states, type roles, the "Death's ledger" framing).
- `CLAUDE.md` — the design and design-voice rules (inspiration-only translation into Nuxt UI tokens; Pratchett's Death voice).
- `app/app.config.ts`, `app/assets/css/main.css` — the current theme baseline.
- `server/db/schema.ts`, `server/sync/score.ts` — the Reap tiers (`fresh/stale/very_stale/dormant`) the life-state palette maps onto.
- `docs/brainstorms/2026-07-01-spared-titles-requirements.md` — the spared feature that maps to the cyan "spared" life-state.
