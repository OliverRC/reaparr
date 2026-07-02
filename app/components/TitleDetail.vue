<script setup lang="ts">
// Shape of GET /api/title/[id] — mirrors the endpoint's success payload.
interface HistoryItem {
  itemKey: string
  lastWatchedAt: string | null
  watchedStatus: number | null
}
interface TitleDetail {
  id: number
  mediaType: string
  title: string
  year: number | null
  spared: boolean
  sparedAt: string | null
  seasonCount: number | null
  sizeOnDisk: number | null
  addedAt: string | null
  seriesStatus: string | null
  seriesType: string | null
  downloadedEpisodes: number | null
  externalIds: { tmdbId: number | null, tvdbId: number | null, imdbId: string | null }
  ratings: { value: number | null, imdb: number | null, rt: number | null }
  score: {
    reapScore: number
    staleness: number
    abandonment: number
    requestMiss: number
    idleDays: number
    completion: number
    freshness: number
    tier: string
    reasons: string[]
  } | null
  requestedBy: string | null
  requestedAt: string | null
  watchers: { name: string, lastWatchedAt: string | null }[]
  watchCount: number
  history: HistoryItem[]
  seasons: { seasonNumber: number, sizeOnDisk: number | null, episodeFiles: number | null }[]
  links: { sonarr: string | null, radarr: string | null, tautulli: string | null }
  sourcesConfigured: { sonarr: boolean, radarr: boolean, tautulli: boolean }
}

const props = defineProps<{ id: number | null, open: boolean }>()
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'spared-changed'): void
}>()

const toast = useToast()
const data = ref<TitleDetail | null>(null)
const pending = ref(false)
const showScore = ref(false) // when spared, the breakdown is collapsed by default
const sparing = ref(false)

async function load(id: number) {
  pending.value = true
  data.value = null
  try {
    data.value = await $fetch<TitleDetail>(`/api/title/${id}`)
    showScore.value = !data.value?.spared
  } finally {
    pending.value = false
  }
}

watch(() => [props.open, props.id] as const, ([open, id]) => {
  if (!open || id == null) return
  load(id)
}, { immediate: true })

async function toggleSpare() {
  if (!data.value) return
  sparing.value = true
  const next = !data.value.spared
  const name = data.value.title
  try {
    await $fetch(`/api/title/${data.value.id}/spare`, { method: 'POST', body: { spared: next } })
    toast.add({
      title: next ? `Spared “${name}”` : `Returned “${name}” to the reap`,
      description: next ? 'Kept forever — pinned to the bottom, not scored.' : undefined,
      color: 'success',
      icon: 'i-lucide-shield'
    })
    await load(data.value.id)
    emit('spared-changed')
  } catch (e) {
    toast.add({ title: 'Action failed', description: (e as Error).message, color: 'error' })
  } finally {
    sparing.value = false
  }
}

const isOpen = computed({
  get: () => props.open,
  set: v => emit('update:open', v)
})

function episodesWatched(d: TitleDetail | null): number {
  if (!d) return 0
  return d.history.filter(h => (h.watchedStatus ?? 0) >= 1).length
}

function humanizeDays(days: number | null): string {
  if (days == null || days >= 99999) return 'never'
  if (days < 45) return `${days} days`
  const months = Math.round(days / 30)
  if (months < 18) return `${months} months`
  return `${(days / 365).toFixed(1)} years`
}

// The three watch/request components that sum to the raw score (spec §8.5).
const components = computed(() => {
  const s = data.value?.score
  if (!s) return []
  const completionPct = s.completion != null ? Math.round(s.completion * 100) : null
  return [
    {
      key: 'Staleness', value: s.staleness, max: 50, barClass: 'bg-error',
      caption: `${tierMeta(s.tier).label} · idle ${humanizeDays(s.idleDays)}`
    },
    {
      key: 'Abandonment', value: s.abandonment, max: 30, barClass: 'bg-warning',
      caption: completionPct != null ? `${completionPct}% watched of what's on disk` : 'not watched'
    },
    {
      key: 'Request-miss', value: s.requestMiss, max: 20, barClass: 'bg-info',
      caption: s.requestMiss > 0 ? 'requested, never watched' : (data.value?.requestedBy ? 'requested & watched' : 'not requested')
    }
  ]
})

const rawScore = computed(() => {
  const s = data.value?.score
  return s ? s.staleness + s.abandonment + s.requestMiss : 0
})

// Quality ratings shown as labelled badges. Series carry a single consolidated
// score; movies carry TMDB, IMDb, and Rotten Tomatoes (the RT % reuses the 0–10
// colour bands via /10).
const ratingItems = computed(() => {
  const r = data.value?.ratings
  if (!r) return []
  const items: { label: string, text: string, color: 'neutral' | 'warning' | 'error' | 'success' }[] = []
  if (data.value?.mediaType === 'series') {
    if (r.value != null) items.push({ label: 'Rating', text: r.value.toFixed(1), color: ratingColor(r.value) })
  } else {
    if (r.value != null) items.push({ label: 'TMDB', text: r.value.toFixed(1), color: ratingColor(r.value) })
    if (r.imdb != null) items.push({ label: 'IMDb', text: r.imdb.toFixed(1), color: ratingColor(r.imdb) })
    if (r.rt != null) items.push({ label: 'Rotten Tomatoes', text: `${r.rt}%`, color: ratingColor(r.rt / 10) })
  }
  return items
})
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :ui="{ content: 'max-w-2xl' }"
  >
    <template #content>
      <div
        v-if="pending"
        class="p-8 text-center text-muted"
      >
        Loading…
      </div>
      <div
        v-else-if="data"
        class="relative p-5 space-y-5"
      >
        <!-- Close -->
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="sm"
          class="absolute top-3 right-3 z-10"
          aria-label="Close"
          @click="() => { isOpen = false }"
        />
        <!-- Header -->
        <div class="flex items-start justify-between gap-4 pr-9">
          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-xl font-bold">
                {{ data.title }}
              </h2>
              <span class="text-muted">{{ data.year }}</span>
            </div>
            <div class="flex items-center gap-2 mt-1">
              <UBadge
                color="neutral"
                variant="subtle"
                size="sm"
                class="capitalize"
              >
                {{ data.mediaType }}
              </UBadge>
              <UBadge
                v-if="data.seriesType && data.seriesType !== 'standard'"
                color="neutral"
                variant="subtle"
                size="sm"
                class="capitalize"
              >
                {{ data.seriesType }}
              </UBadge>
              <UBadge
                v-if="data.seriesStatus"
                :color="data.seriesStatus === 'continuing' ? 'info' : 'neutral'"
                variant="subtle"
                size="sm"
                class="capitalize"
              >
                {{ data.seriesStatus }}
              </UBadge>
            </div>
          </div>
          <div class="text-right">
            <UBadge
              v-if="data.spared"
              color="primary"
              variant="subtle"
              size="lg"
              icon="i-lucide-shield"
            >
              Spared
            </UBadge>
            <template v-else>
              <UBadge
                :color="scoreColor(data.score?.reapScore ?? 0)"
                variant="solid"
                size="lg"
                class="font-bold tabular-nums"
              >
                {{ data.score?.reapScore ?? 0 }}
              </UBadge>
              <div class="text-xs text-muted mt-1">
                Reap Score
              </div>
            </template>
          </div>
        </div>

        <!-- Spared banner -->
        <UAlert
          v-if="data.spared"
          color="primary"
          variant="subtle"
          icon="i-lucide-shield"
          title="Kept forever"
          description="This title is spared from reaping — it stays at the bottom of the list and isn't scored."
        >
          <template #actions>
            <UButton
              color="neutral"
              variant="solid"
              size="sm"
              icon="i-lucide-shield-off"
              :loading="sparing"
              @click="toggleSpare"
            >
              Return to the reap
            </UButton>
          </template>
        </UAlert>

        <!-- Deep-link actions -->
        <div class="flex flex-wrap gap-2">
          <template v-if="data.mediaType === 'series'">
            <UButton
              v-if="data.links.sonarr"
              :to="data.links.sonarr"
              target="_blank"
              icon="i-lucide-external-link"
              color="primary"
              variant="solid"
              size="sm"
            >
              Open in Sonarr
            </UButton>
            <UTooltip
              v-else
              :text="data.sourcesConfigured.sonarr ? 'No Sonarr slug for this title' : 'Set the Sonarr URL in Settings → Connections'"
            >
              <UButton
                icon="i-lucide-external-link"
                color="neutral"
                variant="outline"
                size="sm"
                disabled
              >
                Open in Sonarr
              </UButton>
            </UTooltip>
          </template>
          <template v-else>
            <UButton
              v-if="data.links.radarr"
              :to="data.links.radarr"
              target="_blank"
              icon="i-lucide-external-link"
              color="primary"
              variant="solid"
              size="sm"
            >
              Open in Radarr
            </UButton>
            <UTooltip
              v-else
              :text="data.sourcesConfigured.radarr ? 'No Radarr id for this title' : 'Set the Radarr URL in Settings → Connections'"
            >
              <UButton
                icon="i-lucide-external-link"
                color="neutral"
                variant="outline"
                size="sm"
                disabled
              >
                Open in Radarr
              </UButton>
            </UTooltip>
          </template>

          <UButton
            v-if="data.links.tautulli"
            :to="data.links.tautulli"
            target="_blank"
            icon="i-lucide-history"
            color="neutral"
            variant="outline"
            size="sm"
          >
            View in Tautulli
          </UButton>
          <UTooltip
            v-else
            :text="data.sourcesConfigured.tautulli ? 'No watch history recorded in Tautulli' : 'Set the Tautulli URL in Settings → Connections'"
          >
            <UButton
              icon="i-lucide-history"
              color="neutral"
              variant="outline"
              size="sm"
              disabled
            >
              View in Tautulli
            </UButton>
          </UTooltip>

          <UButton
            v-if="!data.spared"
            icon="i-lucide-shield"
            color="primary"
            variant="outline"
            size="sm"
            :loading="sparing"
            @click="toggleSpare"
          >
            Spare (keep forever)
          </UButton>
        </div>

        <!-- Facts -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <div class="text-xs text-muted uppercase tracking-wide">
              Size
            </div>
            <div class="font-semibold">
              {{ formatBytes(data.sizeOnDisk) }}
            </div>
          </div>
          <div v-if="data.mediaType === 'series'">
            <div class="text-xs text-muted uppercase tracking-wide">
              Seasons
            </div>
            <div class="font-semibold">
              {{ data.seasonCount ?? '—' }}
            </div>
          </div>
          <div v-if="data.mediaType === 'series'">
            <div class="text-xs text-muted uppercase tracking-wide">
              Episodes
            </div>
            <div class="font-semibold">
              {{ episodesWatched(data) }} / {{ data.downloadedEpisodes ?? '—' }} watched
            </div>
          </div>
          <div>
            <div class="text-xs text-muted uppercase tracking-wide">
              Added
            </div>
            <div class="font-semibold">
              {{ formatDate(data.addedAt) }}
            </div>
          </div>
        </div>

        <!-- Quality ratings -->
        <div
          v-if="ratingItems.length"
          class="space-y-2"
        >
          <div class="text-xs text-muted uppercase tracking-wide">
            Ratings
          </div>
          <div class="flex flex-wrap gap-2">
            <div
              v-for="r in ratingItems"
              :key="r.label"
              class="flex items-center gap-2 rounded-md bg-elevated/50 px-3 py-1.5"
            >
              <span class="text-sm text-muted">{{ r.label }}</span>
              <UBadge
                :color="r.color"
                variant="subtle"
                size="md"
                icon="i-lucide-star"
                class="tabular-nums font-medium"
              >
                {{ r.text }}
              </UBadge>
            </div>
          </div>
        </div>

        <!-- Score breakdown — collapsed by default for spared titles -->
        <div
          v-if="data.spared && !showScore"
          class="text-sm"
        >
          <UButton
            color="neutral"
            variant="link"
            size="sm"
            icon="i-lucide-eye"
            class="px-0"
            @click="() => { showScore = true }"
          >
            Show score anyway
          </UButton>
        </div>
        <div
          v-if="data.score && (!data.spared || showScore)"
          class="rounded-lg border border-default p-4 space-y-4"
        >
          <div class="flex items-center justify-between">
            <div class="text-sm font-semibold">
              How this score is built
            </div>
            <UBadge
              :color="tierMeta(data.score.tier).color"
              variant="subtle"
              size="sm"
            >
              {{ tierMeta(data.score.tier).label }}
            </UBadge>
          </div>

          <div class="space-y-3">
            <div
              v-for="c in components"
              :key="c.key"
            >
              <div class="flex items-baseline justify-between text-sm">
                <span class="font-medium">{{ c.key }}</span>
                <span class="tabular-nums text-muted">{{ c.value }} <span class="text-dimmed">/ {{ c.max }}</span></span>
              </div>
              <div class="mt-1 h-2 rounded-full bg-elevated overflow-hidden">
                <div
                  class="h-full rounded-full transition-all"
                  :class="c.barClass"
                  :style="{ width: `${(c.value / c.max) * 100}%` }"
                />
              </div>
              <div class="text-xs text-muted mt-1">
                {{ c.caption }}
              </div>
            </div>
          </div>

          <!-- The formula: raw × freshness = score -->
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1 pt-3 border-t border-default text-sm">
            <span class="text-muted">Raw</span>
            <span class="font-semibold tabular-nums">{{ rawScore }}</span>
            <UIcon
              name="i-lucide-x"
              class="size-3.5 text-dimmed"
            />
            <span class="text-muted">freshness</span>
            <span class="font-semibold tabular-nums">{{ (data.score.freshness ?? 1).toFixed(2) }}</span>
            <UTooltip text="New content ramps in over the grace period instead of being flagged immediately.">
              <UIcon
                name="i-lucide-info"
                class="size-3.5 text-dimmed"
              />
            </UTooltip>
            <UIcon
              name="i-lucide-equal"
              class="size-3.5 text-dimmed"
            />
            <span class="text-muted">Reap Score</span>
            <UBadge
              :color="scoreColor(data.score.reapScore)"
              variant="solid"
              size="md"
              class="font-bold tabular-nums"
            >
              {{ data.score.reapScore }}
            </UBadge>
            <span
              v-if="(data.score.freshness ?? 1) < 1"
              class="text-xs text-warning w-full"
            >
              Recently added — score is still ramping in ({{ Math.round((data.score.freshness ?? 1) * 100) }}% of raw).
            </span>
          </div>

          <div
            v-if="data.score.reasons?.length"
            class="flex flex-wrap gap-1 pt-1"
          >
            <UBadge
              v-for="(r, i) in data.score.reasons"
              :key="i"
              color="neutral"
              variant="outline"
              size="sm"
            >
              {{ r }}
            </UBadge>
          </div>
        </div>

        <!-- Watch history -->
        <div class="space-y-2">
          <div class="text-xs text-muted uppercase tracking-wide">
            Watch history
          </div>
          <div
            v-if="data.requestedBy"
            class="text-sm"
          >
            <UIcon
              name="i-lucide-inbox"
              class="size-4 inline align-text-bottom text-muted"
            />
            Requested by <span class="font-medium">{{ data.requestedBy }}</span>
            <span
              v-if="data.requestedAt"
              class="text-muted"
            > · {{ timeAgo(data.requestedAt) }}</span>
          </div>
          <div
            v-if="data.watchers.length"
            class="space-y-1"
          >
            <div
              v-for="w in data.watchers"
              :key="w.name"
              class="flex items-center justify-between text-sm rounded-md bg-elevated/50 px-3 py-1.5"
            >
              <span class="flex items-center gap-2"><UIcon
                name="i-lucide-eye"
                class="size-4 text-muted"
              /> {{ w.name }}</span>
              <span class="text-muted">last watched {{ timeAgo(w.lastWatchedAt) }}</span>
            </div>
          </div>
          <p
            v-else
            class="text-sm text-error"
          >
            Never watched by anyone.
          </p>
        </div>
      </div>
    </template>
  </UModal>
</template>
