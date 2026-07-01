<script setup lang="ts">
const toast = useToast()
const { data, refresh, pending } = await useFetch('/api/people', { key: 'people' })

// Merge is a secondary action, so it's gated behind an explicit mode. Only then do
// the per-person checkboxes appear — otherwise the page is just a roster.
const mergeMode = ref(false)
const selected = ref<Set<number>>(new Set())
function toggle(id: number) {
  const s = new Set(selected.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selected.value = s
}
function clearSelection() {
  selected.value = new Set()
}
function exitMergeMode() {
  mergeMode.value = false
  clearSelection()
}

const busy = ref(false)
async function act(fn: () => Promise<unknown>, okMsg: string) {
  busy.value = true
  try {
    await fn()
    toast.add({ title: okMsg, color: 'success', icon: 'i-lucide-check' })
    selected.value = new Set()
    await refresh()
  } catch (e) {
    toast.add({ title: 'Action failed', description: (e as Error).message, color: 'error' })
  } finally {
    busy.value = false
  }
}

const mergeSelected = () => act(
  () => $fetch('/api/people/merge', { method: 'POST', body: { personIds: [...selected.value] } }),
  'People merged'
)
const confirm = (personId: number) => act(
  () => $fetch('/api/people/confirm', { method: 'POST', body: { personId } }),
  'Mapping confirmed'
)
const splitOff = (personId: number, identityId: number) => act(
  () => $fetch('/api/people/split', { method: 'POST', body: { personId, identityIds: [identityId] } }),
  'Identity split off'
)
const setMember = (personId: number, isMember: boolean) => act(
  () => $fetch('/api/people/member', { method: 'POST', body: { personId, isMember } }),
  isMember ? 'Marked as member' : 'Removed from members'
)
const setHidden = (personId: number, isHidden: boolean) => act(
  () => $fetch('/api/people/hide', { method: 'POST', body: { personId, isHidden } }),
  isHidden ? 'Person hidden' : 'Person unhidden'
)

// Three sections: active members up top, the general roster in the middle, hidden at the bottom.
const members = computed(() => (data.value?.people ?? []).filter(p => p.isMember && !p.isHidden))
const regular = computed(() => (data.value?.people ?? []).filter(p => !p.isMember && !p.isHidden))
const hidden = computed(() => (data.value?.people ?? []).filter(p => p.isHidden))

const showHidden = ref(false)
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <div class="flex items-start justify-between gap-4 flex-wrap">
      <div class="space-y-1">
        <h1 class="text-2xl font-bold">People</h1>
        <p class="text-muted text-sm">
          Canonical people are auto-matched across Seerr and Tautulli on email or Plex username. Star active members
          (they'll receive reap notifications), and hide the ones you never want to see.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <UBadge color="neutral" variant="subtle">{{ data?.total ?? 0 }} people</UBadge>
        <UBadge color="primary" variant="subtle" icon="i-lucide-user-check">
          {{ data?.memberCount ?? 0 }} members
        </UBadge>
        <UBadge :color="(data?.needsReview ?? 0) > 0 ? 'warning' : 'success'" variant="subtle">
          {{ data?.needsReview ?? 0 }} need review
        </UBadge>
        <UButton
          v-if="!mergeMode"
          icon="i-lucide-merge"
          color="neutral"
          variant="outline"
          size="sm"
          @click="() => { mergeMode = true }"
        >
          Merge…
        </UButton>
      </div>
    </div>

    <UAlert
      v-if="mergeMode"
      color="primary"
      variant="subtle"
      icon="i-lucide-merge"
      :title="selected.size >= 2 ? `${selected.size} people selected` : 'Merge mode'"
      :description="selected.size >= 2 ? undefined : 'Select two or more people to combine them into one.'"
      class="flex items-center"
    >
      <template #actions>
        <UButton color="primary" size="sm" :disabled="selected.size < 2" :loading="busy" @click="mergeSelected">
          Merge selected
        </UButton>
        <UButton color="neutral" variant="ghost" size="sm" @click="exitMergeMode">Cancel</UButton>
      </template>
    </UAlert>

    <div v-if="pending" class="py-10 text-center text-muted">Loading…</div>

    <template v-else>
      <!-- Members -->
      <section v-if="members.length" class="space-y-3">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-user-check" class="size-4 text-primary" />
          <h2 class="text-sm font-semibold uppercase tracking-wide text-muted">Active members</h2>
          <UBadge color="primary" variant="subtle" size="sm">{{ members.length }}</UBadge>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <PersonCard
            v-for="p in members"
            :key="p.id"
            :person="p"
            :selected="selected.has(p.id)"
            :busy="busy"
            :merge-mode="mergeMode"
            @toggle-select="toggle"
            @confirm="confirm"
            @split="splitOff"
            @set-member="setMember"
            @set-hidden="setHidden"
          />
        </div>
      </section>

      <!-- Everyone else -->
      <section v-if="regular.length" class="space-y-3">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-users" class="size-4 text-muted" />
          <h2 class="text-sm font-semibold uppercase tracking-wide text-muted">Everyone else</h2>
          <UBadge color="neutral" variant="subtle" size="sm">{{ regular.length }}</UBadge>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <PersonCard
            v-for="p in regular"
            :key="p.id"
            :person="p"
            :selected="selected.has(p.id)"
            :busy="busy"
            :merge-mode="mergeMode"
            @toggle-select="toggle"
            @confirm="confirm"
            @split="splitOff"
            @set-member="setMember"
            @set-hidden="setHidden"
          />
        </div>
      </section>

      <!-- Hidden (collapsed) -->
      <section v-if="hidden.length" class="space-y-3">
        <button
          class="flex items-center gap-2 text-muted hover:text-default transition-colors"
          @click="showHidden = !showHidden"
        >
          <UIcon :name="showHidden ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4" />
          <UIcon name="i-lucide-eye-off" class="size-4" />
          <h2 class="text-sm font-semibold uppercase tracking-wide">Hidden</h2>
          <UBadge color="neutral" variant="subtle" size="sm">{{ hidden.length }}</UBadge>
        </button>
        <div v-if="showHidden" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <PersonCard
            v-for="p in hidden"
            :key="p.id"
            :person="p"
            :selected="selected.has(p.id)"
            :busy="busy"
            :merge-mode="mergeMode"
            @toggle-select="toggle"
            @confirm="confirm"
            @split="splitOff"
            @set-member="setMember"
            @set-hidden="setHidden"
          />
        </div>
      </section>

      <div v-if="!members.length && !regular.length && !hidden.length" class="py-10 text-center text-muted">
        No people yet — run a sync to populate.
      </div>
    </template>
  </UContainer>
</template>
