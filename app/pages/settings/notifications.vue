<script setup lang="ts">
const toast = useToast()
const { data, refresh } = await useFetch('/api/settings/notifications', { key: 'notifications' })

const form = reactive({ enabled: true, smtpHost: '', smtpPort: 587, smtpUser: '', smtpPass: '', smtpFrom: '' })
const passSet = ref(false)
watchEffect(() => {
  if (data.value) {
    form.enabled = data.value.enabled
    form.smtpHost = data.value.smtpHost
    form.smtpPort = data.value.smtpPort
    form.smtpUser = data.value.smtpUser
    form.smtpFrom = data.value.smtpFrom
    passSet.value = data.value.smtpPassSet
  }
})

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    await $fetch('/api/settings/notifications', { method: 'PUT', body: { ...form } })
    toast.add({ title: 'Notifications saved', color: 'success', icon: 'i-lucide-check' })
    form.smtpPass = ''
    await refresh()
  } catch (e) {
    toast.add({ title: 'Save failed', description: (e as Error).message, color: 'error' })
  } finally {
    saving.value = false
  }
}

const testTo = ref('')
const testing = ref(false)
async function sendTest() {
  testing.value = true
  try {
    const res = await $fetch<{ ok: boolean, transport: string, to: string, message?: string }>('/api/settings/notifications/test', {
      method: 'POST', body: { to: testTo.value }
    })
    toast.add({
      title: `Test ${res.transport === 'log' ? 'logged' : 'sent'} to ${res.to}`,
      description: res.transport === 'log' ? 'No SMTP configured — logged only.' : undefined,
      color: 'success', icon: 'i-lucide-mail-check'
    })
  } catch (e) {
    const msg = (e as { data?: { message?: string } }).data?.message ?? (e as Error).message
    toast.add({ title: 'Test failed', description: msg, color: 'error' })
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <UContainer class="py-8 space-y-6 max-w-2xl">
    <div class="flex items-center justify-between">
      <div class="space-y-1">
        <h1 class="text-2xl font-bold">
          Notifications
        </h1>
        <p class="text-muted text-sm">
          Email members when a title enters the Sands, is spoken for, or passes. Bring your own SMTP.
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
          to="/settings/scoring"
          color="neutral"
          variant="ghost"
          icon="i-lucide-sliders-horizontal"
        >
          Scoring
        </UButton>
      </div>
    </div>

    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <div class="font-semibold">
            Email
          </div>
          <USwitch v-model="form.enabled" />
        </div>
      </template>

      <div class="space-y-4">
        <p class="text-xs text-muted">
          When off, no emails are sent (the workflow still runs and logs). Leave the password blank to keep the stored one.
        </p>
        <UFormField
          label="SMTP host"
          name="smtpHost"
        >
          <UInput
            v-model="form.smtpHost"
            placeholder="smtp.example.com"
          />
        </UFormField>
        <div class="grid grid-cols-2 gap-3">
          <UFormField
            label="Port"
            name="smtpPort"
          >
            <UInput
              v-model.number="form.smtpPort"
              type="number"
            />
          </UFormField>
          <UFormField
            label="From address"
            name="smtpFrom"
          >
            <UInput
              v-model="form.smtpFrom"
              placeholder="reaparr@example.com"
            />
          </UFormField>
        </div>
        <UFormField
          label="Username"
          name="smtpUser"
        >
          <UInput
            v-model="form.smtpUser"
            placeholder="optional"
          />
        </UFormField>
        <UFormField
          label="Password"
          name="smtpPass"
        >
          <UInput
            v-model="form.smtpPass"
            type="password"
            :placeholder="passSet ? '•••••••• (stored)' : 'optional'"
          />
        </UFormField>
      </div>

      <template #footer>
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <UInput
              v-model="testTo"
              placeholder="test@example.com"
              size="sm"
              class="w-56"
            />
            <UButton
              color="neutral"
              variant="subtle"
              size="sm"
              icon="i-lucide-send"
              :loading="testing"
              @click="sendTest"
            >
              Send test
            </UButton>
          </div>
          <UButton
            color="primary"
            icon="i-lucide-check"
            :loading="saving"
            @click="save"
          >
            Save
          </UButton>
        </div>
      </template>
    </UCard>
  </UContainer>
</template>
