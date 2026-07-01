<script setup lang="ts">
interface Conn {
  source: string
  label: string
  credentialLabel: string
  probeHint: string
  baseUrl: string
  hasCredential: boolean
  enabled: boolean
  lastStatus: string
  lastError: string | null
  lastTestedAt: string | null
  lastSyncedAt: string | null
}

const toast = useToast()
const { data, refresh, pending } = await useFetch<Conn[]>('/api/settings/connections', { key: 'connections' })

// Local editable form keyed by source (credential is write-only — starts blank).
const form = reactive<Record<string, { baseUrl: string, credential: string, enabled: boolean }>>({})
watchEffect(() => {
  for (const c of data.value ?? []) {
    if (!form[c.source]) form[c.source] = { baseUrl: c.baseUrl, credential: '', enabled: c.enabled }
  }
})

const testing = ref<string | null>(null)
const saving = ref(false)

async function test(source: string) {
  testing.value = source
  try {
    const f = form[source]!
    const res = await $fetch<{ ok: boolean, message: string }>(`/api/settings/connections/${source}/test`, {
      method: 'POST',
      body: { baseUrl: f.baseUrl, credential: f.credential || undefined }
    })
    toast.add({
      title: res.ok ? `${source}: connected` : `${source}: failed`,
      description: res.message,
      color: res.ok ? 'success' : 'error',
      icon: res.ok ? 'i-lucide-check' : 'i-lucide-x'
    })
    await refresh()
  } catch (e) {
    toast.add({ title: 'Test failed', description: (e as Error).message, color: 'error' })
  } finally {
    testing.value = null
  }
}

async function saveAll() {
  saving.value = true
  try {
    const connections = Object.entries(form).map(([source, f]) => ({
      source, baseUrl: f.baseUrl, credential: f.credential || undefined, enabled: f.enabled
    }))
    await $fetch('/api/settings/connections', { method: 'PUT', body: { connections } })
    // Clear entered credentials from the form (they're stored server-side now).
    for (const f of Object.values(form)) f.credential = ''
    toast.add({ title: 'Connections saved', color: 'success', icon: 'i-lucide-check' })
    await refresh()
  } catch (e) {
    toast.add({ title: 'Save failed', description: (e as Error).message, color: 'error' })
  } finally {
    saving.value = false
  }
}

function statusMeta(c: Conn) {
  if (c.lastStatus === 'ok') return { label: 'Connected', color: 'success' as const }
  if (c.lastStatus === 'error') return { label: 'Error', color: 'error' as const }
  return { label: 'Untested', color: 'neutral' as const }
}
</script>

<template>
  <UContainer class="py-8 space-y-6 max-w-3xl">
    <div class="flex items-center justify-between">
      <div class="space-y-1">
        <h1 class="text-2xl font-bold">Connections</h1>
        <p class="text-muted text-sm">Configure each source. Credentials are stored server-side and never shown again.</p>
      </div>
      <UButton to="/settings/scoring" color="neutral" variant="ghost" icon="i-lucide-sliders-horizontal">Scoring</UButton>
    </div>

    <div v-if="pending" class="py-10 text-center text-muted">Loading…</div>

    <div v-else class="space-y-4">
      <UCard v-for="c in data ?? []" :key="c.source">
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <span class="font-semibold">{{ c.label }}</span>
              <UBadge :color="statusMeta(c).color" variant="subtle" size="sm">{{ statusMeta(c).label }}</UBadge>
            </div>
            <USwitch v-model="form[c.source]!.enabled" :label="form[c.source]!.enabled ? 'Enabled' : 'Disabled'" />
          </div>
        </template>

        <div class="space-y-3">
          <UFormField label="Base URL" :help="`Probe: ${c.probeHint}`">
            <UInput v-model="form[c.source]!.baseUrl" placeholder="http://host:port" class="w-full" />
          </UFormField>
          <UFormField :label="c.credentialLabel">
            <UInput
              v-model="form[c.source]!.credential"
              type="password"
              :placeholder="c.hasCredential ? '•••• set (leave blank to keep)' : 'Enter API key'"
              class="w-full"
            />
          </UFormField>
          <p v-if="c.lastError" class="text-xs text-error">{{ c.lastError }}</p>
          <p v-if="c.lastSyncedAt" class="text-xs text-muted">Last synced {{ timeAgo(c.lastSyncedAt) }}</p>
        </div>

        <template #footer>
          <div class="flex justify-end">
            <UButton
              color="neutral"
              variant="subtle"
              icon="i-lucide-plug-zap"
              :loading="testing === c.source"
              @click="test(c.source)"
            >
              Test connection
            </UButton>
          </div>
        </template>
      </UCard>

      <div class="flex justify-end">
        <UButton color="primary" icon="i-lucide-save" :loading="saving" @click="saveAll">Save all</UButton>
      </div>
    </div>
  </UContainer>
</template>
