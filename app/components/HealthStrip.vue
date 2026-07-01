<script setup lang="ts">
const emit = defineEmits<{ (e: 'synced'): void }>()
const toast = useToast()

const { data: status, refresh, pending } = await useFetch('/api/sync/status', { key: 'sync-status' })
const syncing = ref(false)

async function syncNow() {
  syncing.value = true
  try {
    const res = await $fetch<{ ok: boolean, message?: string, mode?: string }>('/api/sync', { method: 'POST' })
    if (res.ok) {
      toast.add({ title: res.mode === 'demo' ? 'Demo data refreshed' : 'Sync complete', color: 'success', icon: 'i-lucide-check' })
      await refresh()
      emit('synced')
    } else {
      toast.add({ title: 'Sync failed', description: res.message, color: 'error' })
    }
  } catch (e) {
    toast.add({ title: 'Sync failed', description: (e as Error).message, color: 'error' })
  } finally {
    syncing.value = false
  }
}

function sourceColor(s: { configured: boolean, enabled: boolean, lastStatus: string | null }) {
  if (!s.configured || !s.enabled) return 'neutral'
  if (s.lastStatus === 'ok') return 'success'
  if (s.lastStatus === 'error') return 'error'
  return 'warning'
}
function sourceLabel(s: { source: string, configured: boolean, enabled: boolean, lastStatus: string | null }) {
  if (!s.configured) return `${s.source}: not set`
  if (!s.enabled) return `${s.source}: disabled`
  return `${s.source}: ${s.lastStatus ?? 'untested'}`
}

defineExpose({ refresh })
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <UBadge v-if="status?.demoMode" color="primary" variant="subtle" icon="i-lucide-flask-conical">
      Demo mode
    </UBadge>
    <UBadge
      v-for="s in status?.sources ?? []"
      :key="s.source"
      :color="sourceColor(s)"
      variant="subtle"
      class="capitalize"
    >
      {{ sourceLabel(s) }}
    </UBadge>

    <div class="grow" />

    <span v-if="status?.latest?.finishedAt" class="text-xs text-muted">
      Last sync {{ timeAgo(status.latest.finishedAt) }}
    </span>
    <UButton
      icon="i-lucide-refresh-cw"
      :loading="syncing || pending"
      color="primary"
      @click="syncNow"
    >
      Sync now
    </UButton>
  </div>
</template>
