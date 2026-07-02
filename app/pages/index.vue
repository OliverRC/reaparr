<script setup lang="ts">
const toast = useToast()
const tab = ref<'series' | 'movie'>('series')
const sort = ref<'score' | 'size'>('score')
const titleFilter = ref('')
const pagination = ref({ pageIndex: 0, pageSize: 25 })

const query = computed(() => ({ type: tab.value, sort: sort.value }))
const { data, refresh, pending, error } = await useFetch('/api/dashboard', { query, key: 'dashboard' })

// Size the pager off the same predicate the table's title column filters on, so
// the total stays reactive to the data and the filter without reaching into the
// table's internal row models.
const filteredCount = computed(() => {
  const rows = data.value?.rows ?? []
  return titleFilter.value
    ? rows.filter(r => matchesTitleQuery(r.title, titleFilter.value)).length
    : rows.length
})

// A filter/tab/sort change reshapes the row set — jump back to the first page so
// we never strand the table on a page that no longer exists. Assign a fresh
// object rather than mutating in place: TanStack memoizes its pagination row
// model on the pagination object's identity, so an in-place edit never re-slices.
watch([titleFilter, tab, sort], () => {
  pagination.value = { ...pagination.value, pageIndex: 0 }
})

// Same reason — hand the pager a new object so the table actually re-paginates.
function setPage(page: number) {
  pagination.value = { ...pagination.value, pageIndex: page - 1 }
}

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
  <UContainer class="py-6 space-y-5">
    <div class="space-y-1">
      <VoiceLine
        as="h1"
        class="text-3xl text-highlighted"
      >
        Books of Life
      </VoiceLine>
      <p class="text-muted text-sm">
        Death walks the shelves and considers each book in turn, weighing how ready it is for the reaping. The higher the Reap Score, the more surely its time has come.
      </p>
    </div>

    <div
      v-if="!error"
      class="grid grid-cols-2 sm:grid-cols-4 gap-2.5"
    >
      <UCard :ui="{ body: 'p-4' }">
        <div class="text-xs text-muted uppercase tracking-wide">
          Titles
        </div>
        <div class="text-xl font-bold font-mono tabular-nums">
          {{ data?.count ?? 0 }}
        </div>
      </UCard>
      <UCard :ui="{ body: 'p-4' }">
        <div class="text-xs text-muted uppercase tracking-wide">
          Total size
        </div>
        <div class="text-xl font-bold font-mono tabular-nums">
          {{ formatBytes(data?.totalSize ?? 0) }}
        </div>
      </UCard>
      <UCard :ui="{ body: 'p-4' }">
        <div class="text-xs text-muted uppercase tracking-wide">
          Reclaimable (score ≥ 50)
        </div>
        <div class="text-xl font-bold font-mono tabular-nums text-error">
          {{ formatBytes(data?.reclaimable ?? 0) }}
        </div>
      </UCard>
      <UCard :ui="{ body: 'p-4' }">
        <div class="text-xs text-muted uppercase tracking-wide flex items-center gap-1">
          <UIcon
            name="i-lucide-shield"
            class="size-3.5 text-primary"
          /> Spared
        </div>
        <div class="text-xl font-bold font-mono tabular-nums">
          {{ data?.sparedCount ?? 0 }}
          <span class="text-sm font-normal text-muted">· {{ formatBytes(data?.sparedSize ?? 0) }}</span>
        </div>
      </UCard>
    </div>

    <UCard>
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <UTabs
            v-model="tab"
            :items="tabItems"
            :content="false"
            size="sm"
          />
          <div class="flex flex-wrap items-center gap-3">
            <UInput
              v-model="titleFilter"
              icon="i-lucide-search"
              placeholder="Filter by title…"
              size="lg"
              class="w-64 sm:w-80"
              :ui="{ trailing: 'pe-1' }"
            >
              <template
                v-if="titleFilter"
                #trailing
              >
                <UButton
                  color="neutral"
                  variant="link"
                  size="sm"
                  icon="i-lucide-x"
                  aria-label="Clear filter"
                  @click="() => { titleFilter = '' }"
                />
              </template>
            </UInput>
            <div class="flex items-center gap-2 text-sm">
              <span class="text-muted">Sort:</span>
              <div class="flex gap-1">
                <UButton
                  size="sm"
                  :color="sort === 'score' ? 'primary' : 'neutral'"
                  :variant="sort === 'score' ? 'solid' : 'outline'"
                  @click="setSort('score')"
                >
                  Score
                </UButton>
                <UButton
                  size="sm"
                  :color="sort === 'size' ? 'primary' : 'neutral'"
                  :variant="sort === 'size' ? 'solid' : 'outline'"
                  @click="setSort('size')"
                >
                  Size
                </UButton>
              </div>
            </div>
            <UPagination
              v-if="!error && !pending && filteredCount > pagination.pageSize"
              :page="pagination.pageIndex + 1"
              :items-per-page="pagination.pageSize"
              :total="filteredCount"
              size="sm"
              @update:page="setPage"
            />
          </div>
        </div>
      </template>

      <div
        v-if="error"
        class="py-12 text-center space-y-4"
      >
        <VoiceLine class="text-xl text-highlighted">
          The ledger will not open.
        </VoiceLine>
        <p class="text-sm text-muted">
          The Books of Life could not be read. This is a failure, not an empty library.
        </p>
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-rotate-cw"
          @click="() => refresh()"
        >
          Try again
        </UButton>
      </div>
      <div
        v-else-if="pending"
        class="py-12 text-center"
      >
        <VoiceLine
          status
          class="text-xl text-muted"
        >
          The ledger is being read.
        </VoiceLine>
      </div>
      <MediaTable
        v-else
        v-model:filter="titleFilter"
        v-model:pagination="pagination"
        :rows="(data?.rows ?? []) as any"
        :type="tab"
        :sort="sort"
        @update:sort="setSort"
        @select="openDetail"
        @spare="onSpare"
      />
      <template #footer>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-xs text-muted">
            Click any row for its watch history and links; use the shield to Spare a keeper.
          </p>
          <UPagination
            v-if="!error && !pending && filteredCount > pagination.pageSize"
            :page="pagination.pageIndex + 1"
            :items-per-page="pagination.pageSize"
            :total="filteredCount"
            size="sm"
            @update:page="setPage"
          />
        </div>
      </template>
    </UCard>

    <TitleDetail
      :id="selectedId"
      v-model:open="detailOpen"
      @spared-changed="refresh"
    />
  </UContainer>
</template>
