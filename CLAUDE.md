# CLAUDE.md

Guidance for working in this repository.

## Design

- Anything in the `design/` folder is **inspiration only** — reference mockups, never a source of truth. Do not copy its markup, class names, or styling verbatim into the app.
- Never introduce `design/` design tokens (colors, spacing, radii, typography, shadows, etc.) into the main application. Translate them into the equivalent **Nuxt** / **Nuxt UI** tokens instead, and use those.
  - Set semantic colors and theme via `app/app.config.ts` (`ui.colors`) and CSS variables / `@theme` in `app/assets/css/main.css`.
  - Prefer Nuxt UI components and their design-token system over ad-hoc styles pulled from `design/`.

## Frontend

- **Use Nuxt UI components.** Reach for a Nuxt UI component first; only hand-roll markup when no Nuxt UI component can do the job.
- **Stay on the Nuxt UI / Tailwind design tokens.** Do not introduce your own CSS custom properties (variables) unless there is genuinely no token that fits. Set theme via `app/app.config.ts` (`ui.colors`) and the `@theme` block in `app/assets/css/main.css`, and consume the resulting tokens.
- **Prefer Tailwind utility classes.** Avoid scoped `<style>` blocks and custom CSS classes wherever possible — style with utilities. Reserve custom CSS for the rare cases a utility genuinely cannot express (e.g. the shared `.voice-death` treatment).

## Design voice

- The app leans heavily into the theme of **Death** from Terry Pratchett's Discworld — the book *Mort* is a key inspiration. The tone is dry, deadpan, and quietly amused; wry rather than grim.
- Death speaks **in a flat monotone, rendered in small caps, with no quotation marks** — his signature in the books. Use this for **headlines and empty states** to give copy his voice.
  - Apply an appropriate monospace / monotone display font and `text-transform: uppercase` (or a small-caps treatment) so the text reads the way Death speaks, e.g. `THERE IS NOTHING HERE YET.`
  - Keep it to voice moments (headlines, empty states, and similar flavor copy) — do not render normal body text, form labels, or functional UI in Death's voice, where readability and clarity come first.
- **The voice is a frontend-only aesthetic.** It applies to rendered copy in the presentation layer, and nowhere else. The database, schemas, migrations, API payloads, function and variable names, and any data objects passed around must stay **neutral and functional** — describe what the code does, not how Death would say it. Apply the voice *over* neutral data at render time; never bake it into identifiers or stored/transmitted values.
  - Backend-generated strings that surface as data (e.g. score reasons, tier and status labels) stay plain and descriptive. If they need Death's voice, add it in the frontend.
  - The product's own domain terms (e.g. `reap`, `reapScore`, `spared`) are functional vocabulary, not the voice — they may appear anywhere.

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues, via the `gh` CLI. External PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context (`CONTEXT.md` + `docs/adr/` at root). See `docs/agents/domain.md`.
