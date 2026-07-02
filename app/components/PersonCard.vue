<script setup lang="ts">
interface Identity {
  id: number
  source: string
  sourceUserId: string
  username: string | null
  email: string | null
  friendlyName: string | null
}
interface Person {
  id: number
  displayName: string
  customName: string | null
  isMember: boolean
  isHidden: boolean
  requestCount: number
  watchedTitles: number
  identities: Identity[]
}

const props = defineProps<{
  person: Person
  busy: boolean
}>()

const emit = defineEmits<{
  (e: 'set-member' | 'set-hidden', id: number, flag: boolean): void
  (e: 'set-display-name', id: number, name: string | null): void
}>()

// Inline rename — the one persisted name override (ADR-0007). Saving an empty value clears the
// custom name, reverting to the source-derived one.
const editing = ref(false)
const draft = ref('')
function startEdit() {
  draft.value = props.person.customName ?? props.person.displayName
  editing.value = true
}
function saveName() {
  emit('set-display-name', props.person.id, draft.value.trim() || null)
  editing.value = false
}
function cancelEdit() {
  editing.value = false
}
</script>

<template>
  <UCard
    :class="[
      person.isMember && !person.isHidden ? 'bg-primary/5' : '',
      person.isHidden ? 'opacity-70' : ''
    ]"
  >
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0 flex-1">
        <div
          v-if="editing"
          class="flex items-center gap-1.5"
        >
          <UInput
            v-model="draft"
            size="sm"
            placeholder="Custom name"
            autofocus
            class="flex-1"
            @keydown.enter="saveName"
            @keydown.esc="cancelEdit"
          />
          <UButton
            icon="i-lucide-check"
            size="xs"
            color="success"
            variant="subtle"
            :loading="busy"
            title="Save"
            @click="saveName"
          />
          <UButton
            icon="i-lucide-x"
            size="xs"
            color="neutral"
            variant="ghost"
            title="Cancel"
            @click="cancelEdit"
          />
        </div>
        <div
          v-else
          class="flex items-center gap-1.5 min-w-0"
        >
          <span class="font-semibold truncate">{{ person.displayName }}</span>
          <UButton
            icon="i-lucide-pencil"
            size="xs"
            color="neutral"
            variant="ghost"
            title="Rename"
            @click="startEdit"
          />
          <UBadge
            v-if="person.customName"
            color="neutral"
            variant="subtle"
            size="sm"
          >
            custom
          </UBadge>
          <UBadge
            v-if="person.isMember"
            color="primary"
            variant="subtle"
            size="sm"
            icon="i-lucide-user-check"
          >
            Member
          </UBadge>
        </div>
      </div>
      <div class="flex items-start gap-1 shrink-0">
        <div class="text-right text-xs text-muted mr-1">
          <div>{{ person.requestCount }} requests</div>
          <div>{{ person.watchedTitles }} watched</div>
        </div>
        <UButton
          :icon="person.isMember ? 'i-lucide-star' : 'i-lucide-star-off'"
          :color="person.isMember ? 'primary' : 'neutral'"
          variant="ghost"
          size="sm"
          :loading="busy"
          :title="person.isMember ? 'Active member — remove from members' : 'Mark as active member (receives reap notifications)'"
          @click="emit('set-member', person.id, !person.isMember)"
        />
        <UButton
          :icon="person.isHidden ? 'i-lucide-eye' : 'i-lucide-eye-off'"
          color="neutral"
          variant="ghost"
          size="sm"
          :loading="busy"
          :title="person.isHidden ? 'Unhide — bring back into view' : 'Hide — move to the hidden section'"
          @click="emit('set-hidden', person.id, !person.isHidden)"
        />
      </div>
    </div>

    <div class="mt-3 space-y-1.5">
      <div
        v-for="id in person.identities"
        :key="id.id"
        class="flex items-center gap-2 text-sm rounded-md bg-elevated/50 px-2 py-1 min-w-0"
      >
        <UBadge
          :color="id.source === 'seerr' ? 'info' : 'primary'"
          variant="subtle"
          size="sm"
          class="capitalize"
        >
          {{ id.source }}
        </UBadge>
        <span class="truncate">{{ id.username || id.friendlyName || id.email || id.sourceUserId }}</span>
        <span
          v-if="id.email"
          class="text-muted text-xs truncate"
        >{{ id.email }}</span>
      </div>
    </div>
  </UCard>
</template>
