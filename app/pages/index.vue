<script setup lang="ts">
const toast = useToast()
const tab = ref<'series' | 'movie'>('series')
const sort = ref<'score' | 'size'>('score')

const query = computed(() => ({ type: tab.value, sort: sort.value }))
const { data, refresh, pending } = await useFetch('/api/dashboard', { query, key: 'dashboard' })

async function onSpare({ id, title, spared }: { id: number, title: string, spared: boolean }) {
  try {
    await $fetch(`/api/title/${id}/spare`, { method: 'POST', body: { spared } })
    toast.add({
      title: spared ? `Spared “${title}”` : `Returned “${title}” to the reap`,
      description: spared ? 'Kept forever — pinned to the bottom, not scored.' : undefined,
      color: 'success',
      icon: 'i-lucide-shield'
    })
    await refresh()
  } catch (e) {
    toast.add({ title: 'Action failed', description: (e as Error).message, color: 'error' })
  }
}

const tabItems = [
  { label: 'Series', value: 'series', icon: 'i-lucide-tv' },
  { label: 'Movies', value: 'movie', icon: 'i-lucide-film' }
]

async function onSynced() {
  await refresh()
}

function setSort(v: 'score' | 'size') {
  sort.value = v
}

const selectedId = ref<number | null>(null)
const detailOpen = ref(false)
function openDetail(id: number) {
  selectedId.value = id
  detailOpen.value = true
}
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <div class="space-y-1">
      <h1 class="text-2xl font-bold">Reclaim dashboard</h1>
      <p class="text-muted text-sm">
        Priority-ranked deletion candidates. Higher Reap Score = stronger candidate. Size shows what you'd reclaim — it never moves the score.
      </p>
    </div>

    <HealthStrip @synced="onSynced" />

    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <UCard :ui="{ body: 'p-4' }">
        <div class="text-xs text-muted uppercase tracking-wide">Titles</div>
        <div class="text-xl font-bold tabular-nums">{{ data?.count ?? 0 }}</div>
      </UCard>
      <UCard :ui="{ body: 'p-4' }">
        <div class="text-xs text-muted uppercase tracking-wide">Total size</div>
        <div class="text-xl font-bold tabular-nums">{{ formatBytes(data?.totalSize ?? 0) }}</div>
      </UCard>
      <UCard :ui="{ body: 'p-4' }">
        <div class="text-xs text-muted uppercase tracking-wide">Reclaimable (score ≥ 50)</div>
        <div class="text-xl font-bold tabular-nums text-error">{{ formatBytes(data?.reclaimable ?? 0) }}</div>
      </UCard>
      <UCard :ui="{ body: 'p-4' }">
        <div class="text-xs text-muted uppercase tracking-wide flex items-center gap-1">
          <UIcon name="i-lucide-shield" class="size-3.5 text-primary" /> Spared
        </div>
        <div class="text-xl font-bold tabular-nums">
          {{ data?.sparedCount ?? 0 }}
          <span class="text-sm font-normal text-muted">· {{ formatBytes(data?.sparedSize ?? 0) }}</span>
        </div>
      </UCard>
    </div>

    <UCard>
      <template #header>
        <div class="flex items-center justify-between gap-4">
          <UTabs
            v-model="tab"
            :items="tabItems"
            :content="false"
            size="sm"
          />
          <div class="flex items-center gap-2 text-sm">
            <span class="text-muted">Sort:</span>
            <div class="flex gap-1">
              <UButton size="sm" :color="sort === 'score' ? 'primary' : 'neutral'" :variant="sort === 'score' ? 'solid' : 'outline'" @click="setSort('score')">Score</UButton>
              <UButton size="sm" :color="sort === 'size' ? 'primary' : 'neutral'" :variant="sort === 'size' ? 'solid' : 'outline'" @click="setSort('size')">Size</UButton>
            </div>
          </div>
        </div>
      </template>

      <div v-if="pending" class="py-10 text-center text-muted">Loading…</div>
      <MediaTable
        v-else
        :rows="(data?.rows ?? []) as any"
        :type="tab"
        :sort="sort"
        @update:sort="setSort"
        @select="openDetail"
        @spare="onSpare"
      />
      <template #footer>
        <p class="text-xs text-muted">Click any row for its watch history and links; use the shield to Spare a keeper.</p>
      </template>
    </UCard>

    <TitleDetail v-model:open="detailOpen" :id="selectedId" @spared-changed="refresh" />
  </UContainer>
</template>
