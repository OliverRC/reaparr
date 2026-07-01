import { runSync, isSyncRunning } from '../sync/run'
import { isDemoMode, seedDemo } from '../utils/seed'

export default defineEventHandler(async () => {
  if (isSyncRunning()) {
    return { ok: false, message: 'A sync is already running' }
  }
  // In demo mode there are no real sources — refresh the demo picture instead.
  if (isDemoMode()) {
    await seedDemo(true)
    return { ok: true, mode: 'demo', message: 'Demo data refreshed' }
  }
  const result = await runSync()
  return { ok: result.status !== 'error', ...result }
})
