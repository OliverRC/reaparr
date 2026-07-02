<script setup lang="ts">
useHead({
  meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
  link: [{ rel: 'icon', href: '/favicon.ico' }],
  // Dark-lock: `data-color-mode-forced` overrides any stored/system preference,
  // so even a returning visitor who previously chose light renders dark.
  htmlAttrs: { lang: 'en', 'data-color-mode-forced': 'dark' }
})
useSeoMeta({
  title: 'Reaparr',
  description: 'Surface stale, unwatched media as deletion candidates — and see how much space you would reclaim.'
})

const links = [
  { label: 'Books of Life', icon: 'i-lucide-book-open', to: '/' },
  { label: 'People', icon: 'i-lucide-users', to: '/people' },
  { label: 'Settings', icon: 'i-lucide-settings', to: '/settings/connections' }
]
</script>

<template>
  <UApp>
    <UHeader>
      <template #left>
        <NuxtLink to="/" class="flex items-center gap-2 font-bold text-lg">
          <UIcon name="i-lucide-sprout" class="text-primary size-6" />
          <span>Reaparr</span>
        </NuxtLink>
      </template>

      <UNavigationMenu :items="links" />

      <template #right>
        <SystemStatus />
        <UButton
          to="https://github.com"
          target="_blank"
          icon="i-simple-icons-github"
          aria-label="GitHub"
          color="neutral"
          variant="ghost"
        />
      </template>
    </UHeader>

    <UMain>
      <NuxtPage />
    </UMain>

    <UFooter>
      <template #left>
        <p class="text-sm text-muted">
          Reaparr — the read-only Books of Life · {{ new Date().getFullYear() }}
        </p>
      </template>
    </UFooter>
  </UApp>
</template>
