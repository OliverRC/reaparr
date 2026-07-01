import { createSonarrClient } from './sonarr'
import { createRadarrClient } from './radarr'
import { createSeerrClient } from './seerr'
import { createTautulliClient } from './tautulli'
import type { ConnectionConfig, Source, SourceClient } from './types'

export * from './types'
export { createSonarrClient, createRadarrClient, createSeerrClient, createTautulliClient }

export const ALL_SOURCES: Source[] = ['sonarr', 'radarr', 'seerr', 'tautulli']

export const SOURCE_META: Record<Source, { label: string, credentialLabel: string, probeHint: string }> = {
  sonarr: { label: 'Sonarr', credentialLabel: 'API Key', probeHint: 'GET /api/v3/system/status' },
  radarr: { label: 'Radarr', credentialLabel: 'API Key', probeHint: 'GET /api/v3/system/status' },
  seerr: { label: 'Seerr', credentialLabel: 'API Key', probeHint: 'GET /api/v1/status' },
  tautulli: { label: 'Tautulli', credentialLabel: 'API Key', probeHint: 'cmd=get_server_info' }
}

export function createClient(source: Source, config: ConnectionConfig): SourceClient {
  switch (source) {
    case 'sonarr': return createSonarrClient(config)
    case 'radarr': return createRadarrClient(config)
    case 'seerr': return createSeerrClient(config)
    case 'tautulli': return createTautulliClient(config)
  }
}
