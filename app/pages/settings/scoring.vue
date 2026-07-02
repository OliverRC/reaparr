<script setup lang="ts">
const toast = useToast()
const { data, refresh } = await useFetch('/api/settings/scoring', { key: 'scoring' })

const form = reactive({ graceDays: 30, staleT1: 90, staleT2: 180, staleT3: 365 })
watchEffect(() => {
  if (data.value) {
    form.graceDays = data.value.graceDays
    form.staleT1 = data.value.staleT1
    form.staleT2 = data.value.staleT2
    form.staleT3 = data.value.staleT3
  }
})

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    await $fetch('/api/settings/scoring', { method: 'PUT', body: { ...form } })
    toast.add({ title: 'Scoring saved', description: 'Recompute on the next sync.', color: 'success', icon: 'i-lucide-check' })
    await refresh()
  } catch (e) {
    toast.add({ title: 'Save failed', description: (e as Error).message, color: 'error' })
  } finally {
    saving.value = false
  }
}
function reset() {
  if (!data.value) return
  form.graceDays = data.value.defaults.graceDays
  form.staleT1 = data.value.defaults.staleT1
  form.staleT2 = data.value.defaults.staleT2
  form.staleT3 = data.value.defaults.staleT3
}
</script>

<template>
  <UContainer class="py-8 space-y-6 max-w-2xl">
    <div class="flex items-center justify-between">
      <div class="space-y-1">
        <h1 class="text-2xl font-bold">
          Scoring
        </h1>
        <p class="text-muted text-sm">
          The only two knobs. The 50 / 30 / 20 weighting is fixed — there is no rule builder by design.
        </p>
      </div>
      <div class="flex gap-2">
        <UButton
          to="/settings/connections"
          color="neutral"
          variant="ghost"
          icon="i-lucide-plug"
        >
          Connections
        </UButton>
        <UButton
          to="/settings/notifications"
          color="neutral"
          variant="ghost"
          icon="i-lucide-mail"
        >
          Notifications
        </UButton>
      </div>
    </div>

    <UCard>
      <template #header>
        <div class="font-semibold">
          Staleness tiers
        </div>
      </template>
      <div class="space-y-4">
        <UFormField
          label="Stale after (days)"
          help="3-month tier — Staleness contributes ~17."
        >
          <UInput
            v-model.number="form.staleT1"
            type="number"
            class="w-40"
          />
        </UFormField>
        <UFormField
          label="Very stale after (days)"
          help="6-month tier — Staleness ~33."
        >
          <UInput
            v-model.number="form.staleT2"
            type="number"
            class="w-40"
          />
        </UFormField>
        <UFormField
          label="Dormant after (days)"
          help="12-month tier — Staleness maxes at 50."
        >
          <UInput
            v-model.number="form.staleT3"
            type="number"
            class="w-40"
          />
        </UFormField>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <div class="font-semibold">
          New-content grace
        </div>
      </template>
      <UFormField
        label="Grace days"
        help="Freshly added titles ramp in over this many days instead of being flagged immediately."
      >
        <UInput
          v-model.number="form.graceDays"
          type="number"
          class="w-40"
        />
      </UFormField>
    </UCard>

    <div class="flex justify-end gap-2">
      <UButton
        color="neutral"
        variant="ghost"
        @click="reset"
      >
        Reset to defaults
      </UButton>
      <UButton
        color="primary"
        icon="i-lucide-save"
        :loading="saving"
        @click="save"
      >
        Save
      </UButton>
    </div>
  </UContainer>
</template>
