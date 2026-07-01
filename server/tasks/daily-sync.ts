// Scheduled daily sync (D-6). Skipped in demo mode (no real sources configured).
import { runSync } from '../sync/run'
import { isDemoMode } from '../utils/seed'

export default defineTask({
  meta: {
    name: 'daily-sync',
    description: 'Pull from Sonarr/Radarr/Seerr/Tautulli and recompute Reap Scores'
  },
  async run() {
    if (isDemoMode()) return { result: 'skipped (demo mode)' }
    const res = await runSync()
    return { result: `${res.status} (run ${res.runId})` }
  }
})
