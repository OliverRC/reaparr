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
  matchStatus: string
  isMember: boolean
  isHidden: boolean
  requestCount: number
  watchedTitles: number
  identities: Identity[]
}

defineProps<{
  person: Person
  selected: boolean
  busy: boolean
  mergeMode: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-select' | 'confirm', id: number): void
  (e: 'split', personId: number, identityId: number): void
  (e: 'set-member' | 'set-hidden', id: number, flag: boolean): void
}>()

function statusBadge(s: string) {
  if (s === 'needs_review') return { label: 'Needs review', color: 'warning' as const }
  if (s === 'confirmed') return { label: 'Confirmed', color: 'success' as const }
  return { label: 'Auto-matched', color: 'neutral' as const }
}
</script>

<template>
  <UCard
    :class="[
      mergeMode && selected ? 'ring-2 ring-primary' : '',
      mergeMode ? 'cursor-pointer' : '',
      person.isMember && !person.isHidden ? 'bg-primary/5' : '',
      person.isHidden ? 'opacity-70' : ''
    ]"
    @click="mergeMode ? emit('toggle-select', person.id) : undefined"
  >
    <div class="flex items-start justify-between gap-2">
      <div class="flex items-start gap-3 min-w-0">
        <UCheckbox
          v-if="mergeMode"
          :model-value="selected"
          @update:model-value="emit('toggle-select', person.id)"
          @click.stop
        />
        <div class="min-w-0">
          <div class="font-semibold truncate">
            {{ person.displayName }}
          </div>
          <div class="mt-1 flex items-center gap-1.5 flex-wrap">
            <UBadge
              :color="statusBadge(person.matchStatus).color"
              variant="subtle"
              size="sm"
            >
              {{ statusBadge(person.matchStatus).label }}
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
          @click.stop="emit('set-member', person.id, !person.isMember)"
        />
        <UButton
          :icon="person.isHidden ? 'i-lucide-eye' : 'i-lucide-eye-off'"
          color="neutral"
          variant="ghost"
          size="sm"
          :loading="busy"
          :title="person.isHidden ? 'Unhide — bring back into view' : 'Hide — move to the hidden section'"
          @click.stop="emit('set-hidden', person.id, !person.isHidden)"
        />
      </div>
    </div>

    <div class="mt-3 space-y-1.5">
      <div
        v-for="id in person.identities"
        :key="id.id"
        class="flex items-center justify-between gap-2 text-sm rounded-md bg-elevated/50 px-2 py-1"
      >
        <div class="flex items-center gap-2 min-w-0">
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
        <UButton
          v-if="person.identities.length > 1"
          icon="i-lucide-split"
          size="xs"
          color="neutral"
          variant="ghost"
          :loading="busy"
          title="Split this identity into its own person"
          @click.stop="emit('split', person.id, id.id)"
        />
      </div>
    </div>

    <template
      v-if="person.matchStatus !== 'confirmed'"
      #footer
    >
      <div class="flex items-center justify-end gap-2">
        <UButton
          size="sm"
          color="success"
          variant="subtle"
          icon="i-lucide-check"
          :loading="busy"
          @click.stop="emit('confirm', person.id)"
        >
          Confirm
        </UButton>
      </div>
    </template>
  </UCard>
</template>
