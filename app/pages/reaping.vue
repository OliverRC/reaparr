<script setup lang="ts">
import { stateVoice, VOICE } from '~/utils/voice'
import { formatBytes } from '~/utils/format'

interface ReapingRow {
  id: number
  mediaType: 'series' | 'movie'
  title: string
  year: number | null
  sizeOnDisk: number
  reapScore: number
  state: string
  dueAt: string | null
  appellants: string[]
  requestedBy: string | null
  watchedBy: string[]
  links: { sonarr: string | null, radarr: string | null, tautulli: string | null }
}

const toast = useToast()
const { data: sands, refresh: refreshSands } = await useFetch<{ rows: ReapingRow[] }>('/api/reaping/sands', { key: 'sands' })
const { data: due, refresh: refreshDue } = await useFetch<{ rows: ReapingRow[] }>('/api/reaping/due', { key: 'due' })

async function refreshAll() {
  await Promise.all([refreshSands(), refreshDue()])
}

function daysLeft(dueAt: string | null): string {
  if (!dueAt) return '—'
  const days = Math.ceil((Date.parse(dueAt) - Date.now()) / 86_400_000)
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  return `${days} day${days === 1 ? '' : 's'}`
}

async function act(url: string, body: Record<string, unknown>, ok: string) {
  try {
    await $fetch(url, { method: 'POST', body })
    toast.add({ title: ok, color: 'success', icon: 'i-lucide-hourglass' })
    await refreshAll()
  } catch (e) {
    toast.add({ title: 'Action failed', description: (e as Error).message, color: 'error' })
  }
}

const cancel = (r: ReapingRow) => act(`/api/title/${r.id}/cancel`, {}, `Spared “${r.title}” from the reaping`)
const grant = (r: ReapingRow) => act(`/api/title/${r.id}/appeal-resolve`, { decision: 'grant' }, VOICE.reprieveGranted)
const deny = (r: ReapingRow) => act(`/api/title/${r.id}/appeal-resolve`, { decision: 'deny' }, 'Appeal denied — the clock continues')
const markRemoved = (r: ReapingRow) => act(`/api/title/${r.id}/mark-removed`, {}, `“${r.title}” marked removed`)
</script>

<template>
  <UContainer class="py-6 space-y-8">
    <!-- The Life-Timer Room: the hall of hourglasses, holding both sub-lists below -->
    <header class="space-y-1">
      <VoiceLine
        as="h1"
        class="text-3xl text-highlighted"
      >
        {{ VOICE.lifeTimerRoom }}
      </VoiceLine>
      <p class="text-muted text-sm">
        Every title with an hourglass — those still running, and those whose sand has run out.
      </p>
    </header>

    <!-- The Sands -->
    <section class="space-y-3">
      <div class="space-y-1">
        <VoiceLine
          as="h2"
          class="text-2xl text-highlighted"
        >
          {{ VOICE.theSands }}
        </VoiceLine>
        <p class="text-muted text-sm">
          Titles with the clock running. An appeal floats to the top and holds the reaping until you rule on it.
        </p>
      </div>

      <VoiceLine
        v-if="!sands?.rows?.length"
        class="text-muted py-6"
      >
        {{ VOICE.emptySands }}
      </VoiceLine>

      <div
        v-for="r in sands?.rows"
        :key="r.id"
        class="flex items-center gap-3 rounded-lg border border-default p-3"
      >
        <UBadge
          :color="stateVoice(r.state).color"
          variant="subtle"
          class="voice-death shrink-0"
        >
          {{ stateVoice(r.state).label }}
        </UBadge>
        <div class="min-w-0 flex-1">
          <p class="font-medium text-default truncate">
            {{ r.title }} <span class="text-muted text-xs">{{ r.year }}</span>
          </p>
          <p class="text-xs text-muted">
            Due in {{ daysLeft(r.dueAt) }} · {{ formatBytes(r.sizeOnDisk) }}
            <span v-if="r.appellants.length"> · spoken for by {{ r.appellants.join(', ') }}</span>
          </p>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <template v-if="r.state === 'appealed'">
            <UButton
              size="xs"
              color="success"
              icon="i-lucide-check"
              @click="grant(r)"
            >
              Grant
            </UButton>
            <UButton
              size="xs"
              color="neutral"
              variant="subtle"
              icon="i-lucide-x"
              @click="deny(r)"
            >
              Deny
            </UButton>
          </template>
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-undo-2"
            @click="cancel(r)"
          >
            Cancel
          </UButton>
        </div>
      </div>
    </section>

    <!-- The Appointed Hour -->
    <section class="space-y-3">
      <div class="space-y-1">
        <VoiceLine
          as="h2"
          class="text-2xl text-highlighted"
        >
          {{ VOICE.appointedHour }}
        </VoiceLine>
        <p class="text-muted text-sm">
          Their grace has elapsed. Remove them in Sonarr/Radarr, then mark them so — the next sync confirms it.
        </p>
      </div>

      <VoiceLine
        v-if="!due?.rows?.length"
        class="text-muted py-6"
      >
        {{ VOICE.emptyDue }}
      </VoiceLine>

      <div
        v-for="r in due?.rows"
        :key="r.id"
        class="flex items-center gap-3 rounded-lg border border-default p-3"
      >
        <UBadge
          color="error"
          variant="subtle"
          class="voice-death shrink-0"
        >
          {{ stateVoice(r.state).label }}
        </UBadge>
        <div class="min-w-0 flex-1">
          <p class="font-medium text-default truncate">
            {{ r.title }} <span class="text-muted text-xs">{{ r.year }}</span>
          </p>
          <p class="text-xs text-muted">
            {{ formatBytes(r.sizeOnDisk) }} · score {{ r.reapScore }}
          </p>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <UButton
            v-if="r.links.sonarr"
            size="xs"
            color="neutral"
            variant="subtle"
            icon="i-lucide-external-link"
            :to="r.links.sonarr"
            target="_blank"
          >
            Sonarr
          </UButton>
          <UButton
            v-if="r.links.radarr"
            size="xs"
            color="neutral"
            variant="subtle"
            icon="i-lucide-external-link"
            :to="r.links.radarr"
            target="_blank"
          >
            Radarr
          </UButton>
          <UButton
            size="xs"
            color="error"
            icon="i-lucide-check-check"
            @click="markRemoved(r)"
          >
            Mark removed
          </UButton>
        </div>
      </div>
    </section>
  </UContainer>
</template>
