<script setup lang="ts">
interface Row {
  id: number
  mediaType: 'series' | 'movie'
  title: string
  year: number | null
  seasonCount: number | null
  sizeOnDisk: number
  requestedBy: string | null
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
</script>

<template>
  <div class="overflow-x-auto">
    <table class="w-full text-sm border-separate border-spacing-0">
      <thead>
        <tr class="text-left text-muted">
          <th class="py-2 pr-3 font-medium">
            <button class="inline-flex items-center gap-1 hover:text-default" @click="emit('update:sort', 'score')">
              Reap Score
              <UIcon v-if="props.sort === 'score'" name="i-lucide-arrow-down" class="size-3.5" />
            </button>
          </th>
          <th class="py-2 px-3 font-medium">Title</th>
          <th class="py-2 px-3 font-medium text-right">Rating</th>
          <th v-if="type === 'series'" class="py-2 px-3 font-medium text-right">Seasons</th>
          <th class="py-2 px-3 font-medium text-right">
            <button class="inline-flex items-center gap-1 hover:text-default" @click="emit('update:sort', 'size')">
              Size
              <UIcon v-if="props.sort === 'size'" name="i-lucide-arrow-down" class="size-3.5" />
            </button>
          </th>
          <th class="py-2 px-3 font-medium">Requested by</th>
          <th class="py-2 px-3 font-medium">Watched by</th>
          <th class="py-2 px-3 font-medium">Last watched</th>
          <th class="py-2 px-3 font-medium">Why</th>
          <th class="py-2 pl-3 font-medium text-right"><span class="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.id"
          class="border-t border-default hover:bg-elevated/50 cursor-pointer"
          :class="row.spared ? 'opacity-60' : ''"
          @click="emit('select', row.id)"
        >
          <td class="py-3 pr-3 align-top border-t border-default">
            <div v-if="row.spared">
              <UBadge color="primary" variant="subtle" size="md" icon="i-lucide-shield">Spared</UBadge>
            </div>
            <div v-else class="flex items-center gap-2">
              <UBadge :color="scoreColor(row.reapScore)" variant="solid" size="lg" class="tabular-nums font-bold min-w-10 justify-center">
                {{ row.reapScore }}
              </UBadge>
              <UBadge :color="tierMeta(row.tier).color" variant="subtle" size="sm">{{ tierMeta(row.tier).label }}</UBadge>
            </div>
          </td>
          <td class="py-3 px-3 align-top border-t border-default">
            <div class="font-medium text-default">{{ row.title }}</div>
            <div class="text-xs text-muted">{{ row.year ?? '' }}</div>
          </td>
          <td class="py-3 px-3 align-top text-right border-t border-default">
            <UBadge
              v-if="row.rating != null"
              :color="ratingColor(row.rating)"
              variant="subtle"
              size="md"
              icon="i-lucide-star"
              class="tabular-nums font-medium"
            >{{ row.rating.toFixed(1) }}</UBadge>
            <span v-else class="text-muted">—</span>
          </td>
          <td v-if="type === 'series'" class="py-3 px-3 align-top text-right tabular-nums border-t border-default">
            {{ row.seasonCount ?? '—' }}
          </td>
          <td class="py-3 px-3 align-top text-right tabular-nums font-medium border-t border-default">
            {{ formatBytes(row.sizeOnDisk) }}
          </td>
          <td class="py-3 px-3 align-top border-t border-default">
            <span v-if="row.requestedBy">{{ row.requestedBy }}</span>
            <span v-else class="text-muted">—</span>
          </td>
          <td class="py-3 px-3 align-top border-t border-default">
            <div v-if="row.watchedBy.length" class="flex flex-wrap gap-1">
              <UBadge v-for="w in row.watchedBy" :key="w" color="neutral" variant="subtle" size="sm">{{ w }}</UBadge>
            </div>
            <span v-else class="text-muted">nobody</span>
          </td>
          <td class="py-3 px-3 align-top border-t border-default whitespace-nowrap">
            <span :class="row.watched ? '' : 'text-error'">{{ row.watched ? timeAgo(row.lastWatchedAt) : 'never' }}</span>
          </td>
          <td class="py-3 px-3 align-top border-t border-default max-w-xs">
            <div v-if="!row.spared" class="flex flex-wrap gap-1">
              <UBadge v-for="(r, i) in row.reasons" :key="i" color="neutral" variant="outline" size="sm">{{ r }}</UBadge>
            </div>
            <span v-else class="text-xs text-muted italic">Kept forever — not scored</span>
          </td>
          <td class="py-3 pl-3 align-top border-t border-default text-right">
            <UTooltip :text="row.spared ? 'Return to the reap' : 'Spare (keep forever)'">
              <UButton
                :icon="row.spared ? 'i-lucide-shield-off' : 'i-lucide-shield'"
                :color="row.spared ? 'neutral' : 'primary'"
                variant="ghost"
                size="sm"
                :aria-label="row.spared ? 'Return to the reap' : 'Spare'"
                @click.stop="emit('spare', { id: row.id, title: row.title, spared: !row.spared })"
              />
            </UTooltip>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="10" class="py-10 text-center text-muted">No {{ type === 'series' ? 'series' : 'movies' }} found.</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
