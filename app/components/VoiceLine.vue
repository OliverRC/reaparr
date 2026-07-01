<script setup lang="ts">
// Death's voice (R8) — one reusable treatment wrapping the .voice-death utility.
// Serif small-caps, letter-spaced, no quotation marks (callers pass unpunctuated
// copy). Use only for headlines and empty/loading states, never functional UI (R9).
//
// `as`     — the element to render (default a paragraph; pass a heading for titles).
// `status` — when the line reports a transient state (loading), expose it to
//            assistive tech via role="status" / aria-live so the change is announced.
withDefaults(defineProps<{ as?: string, status?: boolean }>(), {
  as: 'p',
  status: false
})
</script>

<template>
  <component
    :is="as"
    class="voice-death"
    :role="status ? 'status' : undefined"
    :aria-live="status ? 'polite' : undefined"
  >
    <slot />
  </component>
</template>
