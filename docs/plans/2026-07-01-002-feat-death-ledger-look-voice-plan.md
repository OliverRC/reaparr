# feat: Death's Ledger — Look & Voice re-skin

**Date:** 2026-07-01
**Type:** feat · **Depth:** Standard
**Origin:** `docs/brainstorms/2026-07-01-death-ledger-look-voice-requirements.md`

---

## Summary

Re-skin the live app into its **"Death's ledger"** identity by translating the `design/`
mockup's inspiration into Nuxt UI's own theming — never lifting the mockup's markup or
`--void/--eye/--ember` layer. The work is four token/config changes plus one voice
component, proven end-to-end on the dashboard:

- **Cyan "eye" primary**, dark-native, with a **life-state palette** (`success`=sage/alive,
  `warning`=candle/fading, `error`=ember/condemned, `primary`=cyan/spared) retuned as hues.
- **Three type roles** — serif (display + Death's voice), sans (functional UI), mono
  (data/numbers, rationed) — loaded via `@nuxt/fonts`.
- **Death's voice** — one reusable serif small-caps, letter-spaced, unpunctuated treatment
  — on dashboard headlines and empty/loading states only.

**Key de-risking finding:** the tier→life-state mapping already exists in
`app/utils/format.ts` (`tierMeta`: `fresh`→`success`, `stale`→`warning`,
`very_stale`/`dormant`→`error`; the spared badge already renders `primary`). So R6/AE2 are
satisfied by **retuning the semantic color hues**, not by new thresholds or any
`server/sync/score.ts` change. The primary flip (green→cyan) automatically re-accents every
component currently reading `primary`/`text-primary` — the member star, dashboard sort
buttons, the merge bar — which is the intended, app-wide accent change.

---

## Problem frame

The `design/` folder holds a fully-authored identity — dark canvas, a cyan "Death's eye"
accent, ember/candle/sage life-states, a literary serif voice, carved-stone density — and
names itself "Death's ledger." The live app carries none of it: default Nuxt UI
(`primary: green`, `neutral: slate`, Public Sans), indistinguishable from any starter. The
product's reason to exist is opinionated — it ranks media for the reaping — but the
interface doesn't say so. The gap is both visual (palette, type, density) and verbal
(Death's voice, life-state language). Closing it is what makes the app unmistakably this
product. See origin Problem Frame.

---

## Requirements traceability

| Origin req | Covered by |
|---|---|
| R1 dark-native default, no light mode | U2 |
| R2 identity in Nuxt UI tokens, nothing copied from `design/` | U1, U3, U4 (standing `CLAUDE.md` rule) |
| R3 fonts via `@nuxt/fonts` (serif · sans · mono) | U3 |
| R4 dense/tight/carved density & shape | U1 (radius, global), U5 (spacing, dashboard) |
| R5 `primary` = cyan everywhere | U1 |
| R6 Reap tiers → life-state palette | U1 (hue retune; mapping already in `format.ts`) |
| R7 three type roles applied | U3 (roles defined), U5 (applied on dashboard) |
| R8 one reusable voice treatment | U4 |
| R9 voice copy is Pratchett; functional UI stays plain sans | U4 (component), U5 (copy), U6 (parity) |
| R10 voice not user-configurable | U4 (no toggle, no i18n — hardcoded) |
| R11 dashboard wears the full identity | U5 |
| R12 dashboard empty/loading states speak in Death's voice | U5 |
| R13 People & Settings inherit theme/fonts/voice, no bespoke pass | U6 |

**Acceptance examples:** AE1→U2, AE2→U1 (+U5 render), AE3→U4/U5, AE4→U5/U6. See the
Acceptance Examples section for the verification mapping.

---

## Key technical decisions

**KTD1 — Bespoke color scales in `@theme`, aliased through `ui.colors`.** Define five custom
11-shade scales in `app/assets/css/main.css` `@theme` — `eye` (cyan), `sage` (green),
`candle` (amber), `ember` (red), `void` (cool near-black neutral) — mirroring the existing
`--color-green-*` pattern already in that file. Then alias them in `app/app.config.ts`:
`primary: 'eye'`, `neutral: 'void'`, `success: 'sage'`, `warning: 'candle'`, `error: 'ember'`.
This is idiomatic Nuxt UI (colors resolve from `--color-{name}-{shade}` in `@theme`), keeps
the semantic tokens intact so `tierMeta`/`scoreColor` need no edits, and is self-documenting.
*Rejected:* aliasing Tailwind built-ins (`cyan`/`green`/`amber`/`red`) — smaller surface but
the "eye" cyan is a specific spectral hue (`#5ad1ff` family) built-ins don't match, and the
mockup's void→bone neutrals are deliberately cool near-blacks, never Tailwind slate. *Also
rejected:* overriding `--ui-color-{semantic}-*` directly — works, but named scales read better
and match the file's existing convention. The hues are **translated** from the mockup, not
its token layer copied (per `CLAUDE.md`).

**KTD2 — Dark is locked, not toggled.** Force dark as the default and remove the color-mode
toggle rather than shipping a one-way preference the user can escape. Configure Nuxt UI's
bundled color-mode (`colorMode.preference: 'dark'`, `fallback: 'dark'`) and remove
`<UColorModeButton>` from `app/app.vue`. A fresh visitor with no stored preference renders
dark (AE1); no light mode is delivered (R1). **Neutralize any already-stored preference:** the
app currently ships the toggle, so the single admin may already have `light` persisted (color-mode
localStorage key + cookie), which would *override* `preference` and strand them in a light theme
once the toggle is gone. Hard-lock instead of relying on `preference` alone — e.g. `colorMode:
{ preference: 'dark', fallback: 'dark', forced: 'dark' }`-style hard mode, or clear/ignore a
stored `light` value — so returning users are forced dark, not just fresh visitors. *Confirm at
implementation:* the exact config key and the stored-value override behavior against Nuxt UI 4's
bundled color-mode — `colorMode` in `nuxt.config.ts` is the expected seam.

**KTD3 — Mockup font defaults via `@nuxt/fonts` + Google.** EB Garamond (serif → display +
Death's voice), Hanken Grotesk (sans → all functional UI), JetBrains Mono (mono → data,
`tabular-nums`). `@nuxt/fonts` scans CSS `font-family` usage and auto-downloads from Google;
Tailwind v4 wiring is `@theme { --font-serif / --font-sans / --font-mono }`. Declare weights
explicitly in `fonts.families` (serif 500/600 for voice+display; sans 400/500/600; mono
400/500) so voice small-caps and display weights are guaranteed present. Net-new dependency
(origin Dependencies).

**KTD4 — Voice as one component wrapping one utility class.** A single `<VoiceLine>` component
(default-slotted) renders the serif small-caps, letter-spaced, unpunctuated treatment, backed
by one `.voice-death` utility in `main.css`. One treatment, one place to change it (R8); no
central plain/death voice map, no i18n locale (R10, both rejected in origin). Functional UI
never wraps in it (R9). The component exposes an **optional element/tag and an optional
ARIA-status seam** (e.g. a `status` boolean that adds `role="status"` / `aria-live="polite"`)
so its *loading-state* usage announces to assistive tech — a decorative serif heading swapped
into place would otherwise be silent to screen readers.

**KTD5 — Carved density: radius global, spacing dashboard-scoped this pass.** Tighten the
global corner radius via the single `--ui-radius` token (low-risk, one value, and R13 wants
other screens to inherit the global theme). Apply the *denser spacing* only at dashboard scope
this pass — retuning global spacing primitives would visually touch People and Settings
unverified, which R13 explicitly holds out of scope. This resolves origin outstanding question 3.

**KTD6 — Life-states are a hue retune only; no scoring change.** Origin outstanding question 1
(exact tier-to-life-state thresholds) resolves to: reuse the existing tier boundaries
(`staleT1/T2/T3` in `score.ts`) and the existing `tierMeta` mapping as-is. Because both
`tierMeta` and `scoreColor` already emit `success`/`warning`/`error`, retuning those hues flows
the entire dashboard into the life-state palette automatically. `server/sync/score.ts` and the
`format.ts` mapping functions are **not** touched.

---

## High-level technical design

**Token map — the translated identity (inspiration → Nuxt UI token).** Directional; exact
per-shade hex is tuned in U1 against the mockup's scales, not lifted from its token names.

| Life-state | Reap tier(s) / flag | Nuxt UI alias | Custom scale | Anchor hue |
|---|---|---|---|---|
| Alive | `fresh` | `success` | `sage` | green `#6bbd88`-ish |
| Fading | `stale` | `warning` | `candle` | amber `#dcae45`-ish |
| Condemned | `very_stale`, `dormant` | `error` | `ember` | red `#e0563f`-ish |
| Spared / accent | spared flag; app-wide accent | `primary` | `eye` | cyan `#5ad1ff`-ish |
| Chrome | — | `neutral` | `void` | cool near-black `#060709`→`#eef1f6` |

**Type-role assignment (directional):**

```
serif  (EB Garamond)   → --font-serif  → .voice-death, dashboard headlines (display)
sans   (Hanken Grotesk)→ --font-sans   → default body / all functional UI (labels, buttons, forms)
mono   (JetBrains Mono)→ --font-mono   → data cells only: Reap Score, Size, counts (tabular-nums), rationed
```

**Voice component surface (directional, not implementation spec):**

```
<VoiceLine>THERE IS NOTHING HERE TO REAP.</VoiceLine>
  └─ renders serif · uppercase/small-caps · letter-spaced (~0.14em) · no quotation marks
  └─ used at: dashboard empty state, dashboard loading state, dashboard headline
  └─ NOT used at: any button, form label, functional control (R9)
```

**Data flow — why no logic changes:**

```
score.ts tierLabel()  ──►  format.ts tierMeta()  ──►  <UBadge :color="...success|warning|error">
   (unchanged)                (unchanged)                        │
                                                                 ▼
                                     U1 retunes what success/warning/error LOOK like
                                     → same components, new life-state hues (AE2)
```

---

## Implementation units

### U1. Retune the color foundation — cyan primary + life-state scales

**Goal:** Replace the green/slate default with the five-scale life-state palette and cyan
"eye" primary, expressed entirely in Nuxt UI tokens.

**Requirements:** R2, R5, R6, R4 (radius). Advances AE2.
**Dependencies:** none.
**Files:**
- `app/assets/css/main.css` — remove the `--color-green-*` block; add `@theme` scales
  `--color-eye-*`, `--color-sage-*`, `--color-candle-*`, `--color-ember-*`, `--color-void-*`
  (11 shades each, 50–950); set `--ui-radius` tighter (carved).
- `app/app.config.ts` — `ui.colors`: `primary: 'eye'`, `neutral: 'void'`, `success: 'sage'`,
  `warning: 'candle'`, `error: 'ember'`.

**Approach:** Follow the existing green-scale pattern already in `main.css`. Anchor each scale
to the mockup's corresponding hues (translated, per KTD1/KTD6). Confirm Nuxt UI 4 resolves
custom `success`/`warning`/`error` aliases from `ui.colors` (expected); if a custom semantic
alias is not honored, fall back to overriding `--ui-color-{semantic}-{shade}` directly in
`main.css` (KTD1 fallback). No change to `format.ts` or `score.ts`.

**Patterns to follow:** the existing `@theme static { --color-green-* }` block in
`app/assets/css/main.css`; the existing `ui.colors` shape in `app/app.config.ts`.

**Test scenarios:** `Test expectation: none — token/config only, no behavioral logic; verified
visually via AE2.`

**Verification:** Dashboard badges render in the new hues — a `fresh` title reads
alive/sage-green, a `dormant` title reads condemned/ember-red, a spared title reads
cyan/`primary` regardless of score (AE2). Every prior `primary`/`text-primary` element (member
star, sort buttons, merge bar) is now cyan. Nothing renders green-as-accent.

---

### U2. Lock the app dark; remove the color-mode toggle

**Goal:** Dark-native by default with no light mode delivered.

**Requirements:** R1. Advances AE1.
**Dependencies:** none (independent of U1).
**Files:**
- `nuxt.config.ts` — configure bundled color-mode: `preference: 'dark'`, `fallback: 'dark'`.
- `app/app.vue` — remove `<UColorModeButton />` from the header `#right` slot.

**Approach:** Use Nuxt UI 4's bundled color-mode support (origin Dependencies). Confirm the
exact config seam at implementation (KTD2), including how a *stored* `light` value interacts with
`preference` — hard-lock so a returning admin who previously toggled light is forced back to dark
(KTD2). Removing the toggle prevents users reaching an undelivered light mode.

**Test scenarios:** `Test expectation: none — config + template removal; verified via AE1.`

**Verification:** A fresh visitor with cleared storage loads dark (AE1). A returning visitor who
previously had `light` stored also loads dark (the stored-preference override is neutralized). No
color-mode toggle appears in the header. Toggling OS light/dark does not flip the app to a light
theme.

---

### U3. Load the three type-role fonts via `@nuxt/fonts`

**Goal:** Serif, sans, and mono families available as `--font-serif` / `--font-sans` /
`--font-mono`, downloaded and optimized by `@nuxt/fonts`.

**Requirements:** R3, R7 (roles defined). R2 (via tokens).
**Dependencies:** none (independent of U1/U2).
**Files:**
- `package.json` — add `@nuxt/fonts` (dev dependency / module).
- `nuxt.config.ts` — add `'@nuxt/fonts'` to `modules`; add `fonts.families` with EB Garamond
  (500/600), Hanken Grotesk (400/500/600), JetBrains Mono (400/500), Google provider.
- `app/assets/css/main.css` — `@theme`: set `--font-sans: 'Hanken Grotesk', …`,
  `--font-serif: 'EB Garamond', …`, `--font-mono: 'JetBrains Mono', …` (replacing the current
  `--font-sans: 'Public Sans'`). Provide sensible system fallbacks per family.

**Approach:** `@nuxt/fonts` scans `font-family` usage in CSS and auto-downloads from Google
(KTD3); declaring weights in `fonts.families` guarantees the voice/display weights ship.
Tailwind v4 wiring is CSS-variable based — no `processCSSVariables` flag needed. After this
unit, sans is the app-wide default (functional UI already inherits it); serif/mono are wired
but only *applied* in U4/U5.

**Patterns to follow:** the existing `--font-sans` declaration in `main.css`; module list in
`nuxt.config.ts`.

**Test scenarios:** `Test expectation: none — module + token config; verified visually.`

**Verification:** `npm run dev` builds with no font-resolution errors; DevTools shows the three
families downloaded; functional UI renders in Hanken Grotesk (not Public Sans). Note: fresh
`@nuxt/fonts` install may need the native better-sqlite3 rebuild gotcha handled separately —
unrelated to fonts, see project memory.

---

### U4. Death's voice — one reusable treatment

**Goal:** A single component + utility class that renders Death's voice: serif, uppercase/
small-caps, letter-spaced (~0.14em), no quotation marks.

**Requirements:** R8, R9 (component boundary), R10 (no toggle/i18n). R2 (via tokens).
**Dependencies:** U3 (serif font must be loaded).
**Files:**
- `app/assets/css/main.css` — add a `.voice-death` utility: `font-family: var(--font-serif)`,
  `text-transform: uppercase`, `letter-spacing: 0.14em`, medium weight, snug line-height.
- `app/components/VoiceLine.vue` — a thin default-slotted component applying `.voice-death`
  to a heading-level element; props limited to an optional element/tag and an optional
  ARIA-status flag (adds `role="status"`/`aria-live="polite"` for loading usage); no logic branches.

**Approach:** One place to change the voice (KTD4). The component carries no plain/death voice
map and no locale — the voice is fixed identity (R10). Copy is authored *at the call site*
(U5), not inside the component. Functional UI must not use this component (R9).

**Patterns to follow:** existing simple presentational components (`HealthStrip.vue` shape).
Small-caps/uppercase headline styling already appears at `app/pages/people.vue:174`
(`uppercase tracking-wide`) — the same idea, elevated to serif voice.

**Test scenarios:** `Test expectation: none — presentational component, no logic; the test
suite is Node-environment pure-logic only (vitest.config.ts) with no component-mount infra,
and adding DOM-test tooling is out of scope for a look-and-voice pass. Verified visually via
AE3/AE4.`

**Verification:** Rendering `<VoiceLine>THERE IS NOTHING HERE TO REAP.</VoiceLine>` shows serif
small-caps, letter-spaced, with no quotation marks around the copy (AE3). Its loading usage
(status flag set) exposes `role="status"`/`aria-live` so screen readers announce the load. The
component is not used on any button, label, or form control (AE4, enforced by review in U5/U6).

---

### U5. Dress the dashboard — the identity proof

**Goal:** The dashboard wears the full identity end-to-end: cyan accent (from U1), life-state
coloring on titles/scores (from U1), the three type roles applied, carved density, and Death's
voice on every empty/loading state and the headline.

**Requirements:** R11, R12, R7 (applied), R4 (spacing, dashboard-scoped), R9 (copy stays plain
where functional). Advances AE2, AE3, AE4.
**Dependencies:** U1, U2, U3, U4.
**Files:**
- `app/pages/index.vue` — headline `Reclaim dashboard` → serif display (or `<VoiceLine>` if it
  reads as voice); the `pending` loading state (line ~99) → `<VoiceLine>` copy (with the
  ARIA-status flag, KTD4); **capture `error` from the `/api/dashboard` `useFetch`** and render a
  distinct failed-load state (its own voice headline + a plain-sans retry control) — see the
  three-states note below; stat-card numbers → mono/`tabular-nums`; tighten card/grid spacing
  (carved density, KTD5). Keep the descriptive paragraph, tab labels, sort buttons, and
  "Sync now" as **plain sans** (R9).
- `app/components/MediaTable.vue` — empty state (line ~131, "No series/movies found.") →
  `<VoiceLine>` copy; numeric cells (Reap Score badge, Size, Seasons) → mono/`tabular-nums`;
  apply denser row spacing. Column headers, reason chips, and "Requested/Watched by" stay plain
  sans. Badge colors are already life-state via `scoreColor`/`tierMeta` — no color edits here.

**Approach:** Author Death's-voice copy in the Pratchett register — dry, deadpan, wry not grim
(R9) — e.g. empty state `THERE IS NOTHING HERE TO REAP.`, loading `THE LEDGER IS BEING
READ.` Ration mono to data only (R7): scores, sizes, counts — never labels or prose. Density
changes are Tailwind spacing/utility tweaks scoped to these two files (KTD5), not global
primitives.

**Dashboard states are three, not two.** The current dashboard distinguishes only *loading*
(`pending`) and *empty* (`MediaTable`'s `!rows.length` branch) — a failed `/api/dashboard` fetch
falls through to the empty branch. Turning that branch into the emphatic `THERE IS NOTHING HERE
TO REAP.` would make a backend/network error *confidently lie* that the library is empty. So this
unit adds an explicit **failed-load** state distinct from empty: on `error`, show its own voice
headline (e.g. `THE LEDGER WILL NOT OPEN.`) plus a **plain-sans retry** control (R9 keeps the
control functional), never the empty-library line. Empty means "data loaded, zero rows"; error
means "the ledger could not be read." This is a small completeness addition beyond origin R12
(which named only empty/loading) and keeps the identity voice honest.

**Patterns to follow:** existing `tabular-nums` usage in `index.vue` (stat cards) and
`MediaTable.vue` (size/score cells) — extend those with `font-mono`; existing empty/loading
markup being replaced.

**Test scenarios:** `Test expectation: none — presentational/markup changes; the mapping logic
is unchanged (KTD6). Verified via AE2/AE3/AE4 in-browser.`

**Verification (AE-linked):**
- **Covers AE2.** With seeded data, a `fresh` title shows alive/sage, a `dormant` title shows
  condemned/ember, a spared title shows cyan regardless of score.
- **Covers AE3.** Dashboard with zero titles shows the empty headline in Death's voice — serif
  small-caps, no quotation marks. Loading state likewise speaks in voice and announces via
  `role="status"`/`aria-live` to assistive tech.
- **Failed-load state.** With `/api/dashboard` forced to error, the dashboard shows the
  failed-load voice headline and a plain-sans retry control — **not** the empty-library line;
  empty and error are visibly distinct.
- **Covers AE4.** "Sync now", the retry control, sort buttons, tab labels, and column headers
  render plain sans, never Death's voice. Score/size/count values render mono `tabular-nums`.

---

### U6. Inheritance & parity check — People and Settings

**Goal:** Confirm People and Settings inherit the global theme, fonts, and voice availability
cleanly, with the primary flip introducing no regressions, and no bespoke styling added.

**Requirements:** R13, R9 (parity — functional UI stays plain sans everywhere).
**Dependencies:** U1–U5.
**Files (inspection; edits only if a regression is found):**
- `app/pages/people.vue`, `app/components/PersonCard.vue` — verify the member star / merge bar
  now read cyan and remain legible; confirm no green-as-accent remnants.
- `app/pages/settings/connections.vue`, `app/pages/settings/scoring.vue` — verify primary
  buttons, inputs, and the dark canvas inherit correctly.
- `app/components/TitleDetail.vue` — verify the detail modal's badges/score bars
  (`bg-error`/`bg-warning`) read in the new life-state hues and remain legible on dark.

**Approach:** This is primarily a verification unit (no bespoke pass, R13). Fix only true
regressions surfaced by the primary flip or dark-lock — e.g. a hardcoded color that now
clashes, or contrast that fails on the void neutrals. Do not restyle these screens.

**Test scenarios:** `Test expectation: none — inspection/verification unit; any incidental fix
is a color-token correction verified visually.`

**Verification:** People and Settings render on the dark canvas with cyan accents and the three
fonts, with readable contrast throughout; no screen shows a green accent or a light-mode
artifact; no functional control speaks in Death's voice (AE4 holds app-wide).

---

## Scope boundaries

**In scope:** the theme foundation (color, dark-lock, radius), the three fonts, the reusable
voice treatment, the full dashboard identity pass, and an inheritance/parity check across the
remaining screens.

**Deferred for later** (origin scope boundaries — carried verbatim):
- The Reap Queue / active-reaping workflow the mockup hints at (`ReapQueueScreen`) — this
  effort is look and voice, not new features.
- A bespoke styling pass for People and Settings — they inherit the global theme only (U6 is a
  parity check, not a restyle).
- A plain-voice toggle or `@nuxtjs/i18n` locale — considered and dropped; revisit only on real
  demand.
- Light mode.

**Deferred to follow-up work** (plan-local):
- Component/DOM test infrastructure (happy-dom + `@vue/test-utils`/`@nuxt/test-utils`). The
  current suite is Node-environment pure-logic only; adding UI-test tooling is a separate
  investment, not part of a look-and-voice re-skin. Verification here is AE-driven/visual.
- Global spacing-density primitives (beyond radius) — held out this pass to protect the
  unverified inherited screens (KTD5); revisit if People/Settings get their bespoke pass.

---

## Risks & dependencies

- **`@nuxt/fonts` is net-new** (origin Dependencies). Google availability/licensing assumed
  acceptable for a net-new brand. Mitigation: system-font fallbacks per family in `@theme` so a
  font-fetch failure degrades gracefully.
- **Custom semantic-color aliases** (`success: 'sage'`, etc.) — confirm Nuxt UI 4 honors
  non-built-in names in `ui.colors`. Mitigation: KTD1 fallback (direct `--ui-color-{semantic}-*`
  override).
- **Dark-lock config seam** — the exact Nuxt UI 4 color-mode key is confirmed at implementation
  (KTD2); `colorMode` in `nuxt.config.ts` is the expected path.
- **Contrast on void neutrals** — cool near-blacks plus retuned semantic hues could dip below
  legible contrast in dense cells; U6 checks this and corrects tokens if needed.
- **The accent flip is intended, not a regression** (origin Key Decisions) — every green
  accent becoming cyan (member star, sort buttons, merge bar) is expected; U6 confirms it read
  as deliberate, not broken.
- **Native-module note:** a fresh install pulling `@nuxt/fonts` may re-trigger the known
  better-sqlite3 build gotcha on Node 24 (project memory) — unrelated to fonts but worth
  anticipating during U3.

---

## Acceptance examples → verification

| AE | Assertion | Verified in |
|---|---|---|
| AE1 (R1) | Fresh visitor, no stored preference → app renders dark | U2 |
| AE2 (R6, R11) | `fresh`→alive/success, `dormant`→condemned/error, spared→`primary` regardless of score | U1 (hues), U5 (render) |
| AE3 (R8, R12) | Dashboard empty state headline in Death's voice — serif small-caps, no quotation marks | U4 (treatment), U5 (copy) |
| AE4 (R9) | Functional controls (Sync now, form labels) render plain sans, never Death's voice | U5, U6 (app-wide parity) |

---

## Sources & research

- `design/Reaparr App (standalone).html` — inspiration only: the life-state mapping
  (`primary`=eye, `error`=ember, `warning`=candle, `success`=sage, `neutral`=void→bone), the
  cyan/sage/candle/ember/void scale hues, the three type roles, `--tracking-caps: 0.14em`, and
  the `.voice-death` treatment (uppercase, tracked, serif, unpunctuated). Translated into Nuxt
  UI tokens, never lifted (`CLAUDE.md`).
- `CLAUDE.md` — the standing inspiration-only translation rule and the Pratchett Death voice
  (small caps, no quotation marks, headlines/empty-states only).
- `app/app.config.ts`, `app/assets/css/main.css` — current theme baseline being replaced.
- `app/utils/format.ts` — `tierMeta`/`scoreColor` already emit `success`/`warning`/`error`;
  the life-state mapping needs no logic change (KTD6).
- `server/sync/score.ts`, `server/db/schema.ts` — the Reap tiers (`fresh`/`stale`/`very_stale`/
  `dormant`) the palette maps onto; unchanged.
- `nuxt.config.ts`, `vitest.config.ts` — module list and the Node-only pure-logic test posture
  (informs the AE-driven verification approach).
- `@nuxt/fonts` docs (Context7) — `fonts.families` config, Google provider, Tailwind v4 `@theme`
  font-variable wiring.
- Nuxt UI 4 docs (Context7) — `ui.colors` alias resolution from `--color-{name}-*`,
  `--ui-radius`, and bundled color-mode.
- `docs/plans/2026-07-01-001-feat-spared-titles-plan.md` — sibling plan; the spared→cyan
  life-state is the accent this re-skin makes primary.
