// Runs once at server startup: ensure default settings/connections exist and,
// in demo mode (REAPARR_DEMO=1), seed the realistic fake picture (spec §12.2).
import { bootstrap } from '../utils/seed'

export default defineNitroPlugin(async () => {
  try {
    await bootstrap()
  } catch (err) {
    console.error('[reaparr] bootstrap failed:', (err as Error).message)
  }
})
