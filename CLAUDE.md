# CLAUDE.md

Guidance for working in this repository.

## Design

- Anything in the `design/` folder is **inspiration only** — reference mockups, never a source of truth. Do not copy its markup, class names, or styling verbatim into the app.
- Never introduce `design/` design tokens (colors, spacing, radii, typography, shadows, etc.) into the main application. Translate them into the equivalent **Nuxt** / **Nuxt UI** tokens instead, and use those.
  - Set semantic colors and theme via `app/app.config.ts` (`ui.colors`) and CSS variables / `@theme` in `app/assets/css/main.css`.
  - Prefer Nuxt UI components and their design-token system over ad-hoc styles pulled from `design/`.

## Design voice

- The app leans heavily into the theme of **Death** from Terry Pratchett's Discworld — the book *Mort* is a key inspiration. The tone is dry, deadpan, and quietly amused; wry rather than grim.
- Death speaks **in a flat monotone, rendered in small caps, with no quotation marks** — his signature in the books. Use this for **headlines and empty states** to give copy his voice.
  - Apply an appropriate monospace / monotone display font and `text-transform: uppercase` (or a small-caps treatment) so the text reads the way Death speaks, e.g. `THERE IS NOTHING HERE YET.`
  - Keep it to voice moments (headlines, empty states, and similar flavor copy) — do not render normal body text, form labels, or functional UI in Death's voice, where readability and clarity come first.
