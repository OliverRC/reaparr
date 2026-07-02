<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Row as TableRow } from '@tanstack/vue-table'

interface Row {
  id: number
  mediaType: 'series' | 'movie'
  title: string
  year: number | null
  seasonCount: number | null
  sizeOnDisk: number
  requestedBy: string | null
  requestedAt: string | null
  watchedBy: string[]
  lastWatchedAt: string | null
  watched: boolean
  reapScore: number
  tier: string | null
  reasons: string[]
  rating: number | null
  spared: boolean
}

const props = defineProps<{
  rows: Row[]
  type: 'series' | 'movie'
  sort: 'score' | 'size'
}>()
const emit = defineEmits<{
  (e: 'update:sort', v: 'score' | 'size'): void
  (e: 'select', id: number): void
  (e: 'spare', payload: { id: number, title: string, spared: boolean }): void
}>()

// Columns carry only structure + alignment; the rich cell bodies live in the
// #<id>-cell slots below so the existing badge/tooltip markup carries over.
// `title` keeps an accessorKey so the quick-filter column has a value to match.
const columns = computed<TableColumn<Row>[]>(() => {
  const cols: TableColumn<Row>[] = [
    { id: 'reapScore', header: 'Reap Score' },
    { accessorKey: 'title', header: 'Title' },
    { id: 'rating', header: 'Rating', meta: { class: { th: 'text-right', td: 'text-right' } } }
  ]
  if (props.type === 'series') {
    cols.push({ id: 'seasonCount', header: 'Seasons', meta: { class: { th: 'text-right', td: 'text-right' } } })
  }
  cols.push(
    { id: 'size', header: 'Size', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { id: 'requestedBy', header: 'Requested by' },
    { id: 'watchedBy', header: 'Watched by' },
    { id: 'lastWatched', header: 'Last watched' },
    { id: 'reasons', header: 'Why' },
    { id: 'actions', header: '', meta: { class: { td: 'text-right' } } }
  )
  return cols
})

// Spared rows read as dimmed — resolved per-row by UTable via meta.class.tr.
const tableMeta = {
  class: {
    tr: (row: TableRow<Row>) => (row.original.spared ? 'opacity-60' : '')
  }
}

function onSelect(_e: Event, row: TableRow<Row>) {
  emit('select', row.original.id)
}
</script>

<template>
  <UTable
    :data="rows"
    :columns="columns"
    :meta="tableMeta"
    @select="onSelect"
  >
    <!-- Reap Score header: server-side sort trigger -->
    <template #reapScore-header>
      <button class="inline-flex items-center gap-1 hover:text-default" @click="emit('update:sort', 'score')">
        Reap Score
        <UIcon v-if="props.sort === 'score'" name="i-lucide-arrow-down" class="size-3.5" />
      </button>
    </template>
    <template #reapScore-cell="{ row }">
      <div v-if="row.original.spared">
        <UBadge color="primary" variant="subtle" size="md" icon="i-lucide-shield">Spared</UBadge>
      </div>
      <div v-else class="flex items-center gap-2">
        <UBadge :color="scoreColor(row.original.reapScore)" variant="solid" size="lg" class="font-mono tabular-nums font-bold min-w-10 justify-center">
          {{ row.original.reapScore }}
        </UBadge>
        <UBadge :color="tierMeta(row.original.tier).color" variant="subtle" size="sm">{{ tierMeta(row.original.tier).label }}</UBadge>
      </div>
    </template>

    <template #title-cell="{ row }">
      <div class="font-medium text-default">{{ row.original.title }}</div>
      <div class="text-xs text-muted">{{ row.original.year ?? '' }}</div>
    </template>

    <template #rating-cell="{ row }">
      <UBadge
        v-if="row.original.rating != null"
        :color="ratingColor(row.original.rating)"
        variant="subtle"
        size="md"
        icon="i-lucide-star"
        class="font-mono tabular-nums font-medium"
      >{{ row.original.rating.toFixed(1) }}</UBadge>
      <span v-else class="text-muted">—</span>
    </template>

    <template #seasonCount-cell="{ row }">
      <span class="font-mono tabular-nums">{{ row.original.seasonCount ?? '—' }}</span>
    </template>

    <!-- Size header: server-side sort trigger -->
    <template #size-header>
      <button class="inline-flex items-center gap-1 hover:text-default" @click="emit('update:sort', 'size')">
        Size
        <UIcon v-if="props.sort === 'size'" name="i-lucide-arrow-down" class="size-3.5" />
      </button>
    </template>
    <template #size-cell="{ row }">
      <span class="font-mono tabular-nums font-medium">{{ formatBytes(row.original.sizeOnDisk) }}</span>
    </template>

    <template #requestedBy-cell="{ row }">
      <template v-if="row.original.requestedBy">
        <div class="text-default whitespace-nowrap">{{ row.original.requestedBy }}</div>
        <div v-if="row.original.requestedAt" class="text-xs text-muted">{{ timeAgo(row.original.requestedAt) }}</div>
      </template>
      <span v-else class="text-muted">—</span>
    </template>

    <template #watchedBy-cell="{ row }">
      <div v-if="row.original.watchedBy.length" class="flex flex-wrap gap-1">
        <UBadge v-for="w in row.original.watchedBy" :key="w" color="neutral" variant="subtle" size="sm">{{ w }}</UBadge>
      </div>
      <span v-else class="text-muted">nobody</span>
    </template>

    <template #lastWatched-cell="{ row }">
      <span class="whitespace-nowrap" :class="row.original.watched ? '' : 'text-error'">
        {{ row.original.watched ? timeAgo(row.original.lastWatchedAt) : 'never' }}
      </span>
    </template>

    <template #reasons-cell="{ row }">
      <div v-if="!row.original.spared" class="flex flex-wrap gap-1 max-w-xs">
        <UBadge v-for="(r, i) in row.original.reasons" :key="i" color="neutral" variant="outline" size="sm">{{ r }}</UBadge>
      </div>
      <span v-else class="text-xs text-muted italic">Kept forever — not scored</span>
    </template>

    <template #actions-cell="{ row }">
      <UTooltip :text="row.original.spared ? 'Return to the reap' : 'Spare (keep forever)'">
        <UButton
          :icon="row.original.spared ? 'i-lucide-shield-off' : 'i-lucide-shield'"
          :color="row.original.spared ? 'neutral' : 'primary'"
          variant="ghost"
          size="sm"
          :aria-label="row.original.spared ? 'Return to the reap' : 'Spare'"
          @click="emit('spare', { id: row.original.id, title: row.original.title, spared: !row.original.spared })"
        />
      </UTooltip>
    </template>

    <template #empty>
      <VoiceLine class="text-lg text-muted">There is nothing here to reap.</VoiceLine>
    </template>
  </UTable>
</template>
