<script setup lang="ts">
const toast = useToast()
const { data, refresh, pending } = await useFetch('/api/people', { key: 'people' })

const busy = ref(false)
async function act(fn: () => Promise<unknown>, okMsg: string) {
  busy.value = true
  try {
    await fn()
    toast.add({ title: okMsg, color: 'success', icon: 'i-lucide-check' })
    await refresh()
  } catch (e) {
    toast.add({ title: 'Action failed', description: (e as Error).message, color: 'error' })
  } finally {
    busy.value = false
  }
}

const setMember = (personId: number, isMember: boolean) => act(
  () => $fetch('/api/people/member', { method: 'POST', body: { personId, isMember } }),
  isMember ? 'Marked as member' : 'Removed from members'
)
const setHidden = (personId: number, isHidden: boolean) => act(
  () => $fetch('/api/people/hide', { method: 'POST', body: { personId, isHidden } }),
  isHidden ? 'Person hidden' : 'Person unhidden'
)
const setDisplayName = (personId: number, name: string | null) => act(
  () => $fetch('/api/people/display-name', { method: 'POST', body: { personId, displayName: name } }),
  name ? 'Name updated' : 'Name reset'
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
        <h1 class="text-2xl font-bold">
          People
        </h1>
        <p class="text-muted text-sm">
          Canonical people are matched across Seerr and Tautulli on email. Rename anyone whose username
          reads badly, star active members (they'll receive reap notifications), and hide the ones you
          never want to see.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <UBadge
          color="neutral"
          variant="subtle"
        >
          {{ data?.total ?? 0 }} people
        </UBadge>
        <UBadge
          color="primary"
          variant="subtle"
          icon="i-lucide-user-check"
        >
          {{ data?.memberCount ?? 0 }} members
        </UBadge>
      </div>
    </div>

    <div
      v-if="pending"
      class="py-10 text-center text-muted"
    >
      Loading…
    </div>

    <template v-else>
      <!-- Members -->
      <section
        v-if="members.length"
        class="space-y-3"
      >
        <div class="flex items-center gap-2">
          <UIcon
            name="i-lucide-user-check"
            class="size-4 text-primary"
          />
          <h2 class="text-sm font-semibold uppercase tracking-wide text-muted">
            Active members
          </h2>
          <UBadge
            color="primary"
            variant="subtle"
            size="sm"
          >
            {{ members.length }}
          </UBadge>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <PersonCard
            v-for="p in members"
            :key="p.id"
            :person="p"
            :busy="busy"
            @set-member="setMember"
            @set-hidden="setHidden"
            @set-display-name="setDisplayName"
          />
        </div>
      </section>

      <!-- Everyone else -->
      <section
        v-if="regular.length"
        class="space-y-3"
      >
        <div class="flex items-center gap-2">
          <UIcon
            name="i-lucide-users"
            class="size-4 text-muted"
          />
          <h2 class="text-sm font-semibold uppercase tracking-wide text-muted">
            Everyone else
          </h2>
          <UBadge
            color="neutral"
            variant="subtle"
            size="sm"
          >
            {{ regular.length }}
          </UBadge>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <PersonCard
            v-for="p in regular"
            :key="p.id"
            :person="p"
            :busy="busy"
            @set-member="setMember"
            @set-hidden="setHidden"
            @set-display-name="setDisplayName"
          />
        </div>
      </section>

      <!-- Hidden (collapsed) -->
      <section
        v-if="hidden.length"
        class="space-y-3"
      >
        <button
          class="flex items-center gap-2 text-muted hover:text-default transition-colors"
          @click="showHidden = !showHidden"
        >
          <UIcon
            :name="showHidden ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            class="size-4"
          />
          <UIcon
            name="i-lucide-eye-off"
            class="size-4"
          />
          <h2 class="text-sm font-semibold uppercase tracking-wide">
            Hidden
          </h2>
          <UBadge
            color="neutral"
            variant="subtle"
            size="sm"
          >
            {{ hidden.length }}
          </UBadge>
        </button>
        <div
          v-if="showHidden"
          class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        >
          <PersonCard
            v-for="p in hidden"
            :key="p.id"
            :person="p"
            :busy="busy"
            @set-member="setMember"
            @set-hidden="setHidden"
            @set-display-name="setDisplayName"
          />
        </div>
      </section>

      <div
        v-if="!members.length && !regular.length && !hidden.length"
        class="py-10 text-center text-muted"
      >
        No people yet — run a sync to populate.
      </div>
    </template>
  </UContainer>
</template>
