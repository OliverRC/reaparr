<script setup lang="ts">
// Compact source-health indicator for the header: a single dot summarising the
// state of every configured source (Sonarr/Radarr/…), with a popover that breaks
// out the individual sources, the last sync time, and the Sync now action.
const toast = useToast()

const { data: status, refresh, pending } = await useFetch('/api/sync/status', { key: 'sync-status' })
const syncing = ref(false)

async function syncNow() {
  syncing.value = true
  try {
    const res = await $fetch<{ ok: boolean, message?: string, mode?: string }>('/api/sync', { method: 'POST' })
    if (res.ok) {
      toast.add({ title: res.mode === 'demo' ? 'Demo data refreshed' : 'Sync complete', color: 'success', icon: 'i-lucide-check' })
      // Header lives outside any page, so refresh both our own status and the
      // dashboard data by key rather than emitting up to a page component.
      await Promise.all([refresh(), refreshNuxtData('dashboard')])
    } else {
      toast.add({ title: 'Sync failed', description: res.message, color: 'error' })
    }
  } catch (e) {
    toast.add({ title: 'Sync failed', description: (e as Error).message, color: 'error' })
  } finally {
    syncing.value = false
  }
}

type Source = { source: string, configured: boolean, enabled: boolean, lastStatus: string | null, lastError?: string | null }

function sourceColor(s: Source) {
  if (!s.configured || !s.enabled) return 'neutral'
  if (s.lastStatus === 'ok') return 'success'
  if (s.lastStatus === 'error') return 'error'
  return 'warning'
}
function sourceLabel(s: Source) {
  if (!s.configured) return `${s.source}: not set`
  if (!s.enabled) return `${s.source}: disabled`
  return `${s.source}: ${s.lastStatus ?? 'untested'}`
}

// Overall state is derived from the sources that are actually meant to be working
// (configured and enabled). Any error dominates, then any not-yet-ok, else all good.
type Level = 'success' | 'warning' | 'error' | 'neutral'
const overall = computed<{ level: Level, label: string }>(() => {
  const active = (status.value?.sources ?? []).filter(s => s.configured && s.enabled)
  if (active.some(s => s.lastStatus === 'error')) return { level: 'error', label: 'Sources failing' }
  if (active.length === 0) return { level: 'neutral', label: 'No sources' }
  if (active.some(s => s.lastStatus !== 'ok')) return { level: 'warning', label: 'Sources untested' }
  return { level: 'success', label: 'All systems good' }
})

const dotClass: Record<Level, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
  neutral: 'bg-muted'
}
</script>

<template>
  <UPopover :content="{ align: 'end' }">
    <UButton
      color="neutral"
      variant="ghost"
      size="sm"
      class="gap-2"
    >
      <span class="relative flex size-2">
        <span
          v-if="overall.level === 'success'"
          class="absolute inline-flex size-full animate-ping rounded-full opacity-60"
          :class="dotClass[overall.level]"
        />
        <span
          class="relative inline-flex size-2 rounded-full"
          :class="dotClass[overall.level]"
        />
      </span>
      <span class="hidden sm:inline text-sm">{{ overall.label }}</span>
      <UIcon
        name="i-lucide-chevron-down"
        class="size-4 text-dimmed"
      />
    </UButton>

    <template #content>
      <div class="w-64 p-3 space-y-3">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-semibold uppercase tracking-wide text-muted">Sources</span>
          <UBadge
            v-if="status?.demoMode"
            color="primary"
            variant="subtle"
            size="sm"
            icon="i-lucide-flask-conical"
          >
            Demo mode
          </UBadge>
        </div>

        <div class="flex flex-col gap-1.5">
          <UBadge
            v-for="s in status?.sources ?? []"
            :key="s.source"
            :color="sourceColor(s)"
            variant="subtle"
            class="capitalize justify-start w-full"
          >
            {{ sourceLabel(s) }}
          </UBadge>
          <p
            v-if="!(status?.sources ?? []).length"
            class="text-xs text-muted"
          >
            No sources configured yet.
          </p>
        </div>

        <div class="flex items-center justify-between gap-2 pt-1 border-t border-default">
          <span
            v-if="status?.latest?.finishedAt"
            class="text-xs text-muted"
          >
            Last sync {{ timeAgo(status.latest.finishedAt) }}
          </span>
          <span
            v-else
            class="text-xs text-muted"
          >Never synced</span>
          <UButton
            icon="i-lucide-refresh-cw"
            size="sm"
            :loading="syncing || pending"
            color="primary"
            @click="syncNow"
          >
            Sync now
          </UButton>
        </div>
      </div>
    </template>
  </UPopover>
</template>
