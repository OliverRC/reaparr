// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/fonts',
    '@nuxt/ui'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  // Death's domain is black: the app is dark-locked. `preference`/`fallback`
  // render dark for fresh visitors; the app-wide `data-color-mode-forced="dark"`
  // attr in app.vue overrides any previously-stored `light` value so returning
  // users are forced dark too (the toggle has been removed).
  colorMode: {
    preference: 'dark',
    fallback: 'dark'
  },

  compatibilityDate: '2026-06-30',

  nitro: {
    experimental: {
      tasks: true
    },
    scheduledTasks: {
      // Daily sync at 03:00 (D-6). Manual "Sync now" covers on-demand refresh.
      '0 3 * * *': ['daily-sync']
    }
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },

  // Three type roles (R3/R7): serif carries display + Death's voice, sans is the
  // functional UI, mono is rationed for data. @nuxt/fonts downloads these from
  // Google and self-hosts them; the families are wired to --font-* in main.css.
  fonts: {
    families: [
      { name: 'EB Garamond', provider: 'google', weights: [500, 600] },
      { name: 'Hanken Grotesk', provider: 'google', weights: [400, 500, 600] },
      { name: 'JetBrains Mono', provider: 'google', weights: [400, 500] }
    ]
  }
})
