import { getDb, schema } from '../../db/client'
import { ALL_SOURCES, SOURCE_META } from '../../sources'

// Credentials are never echoed in plaintext (FR-17c) — only a "set" flag.
export default defineEventHandler(() => {
  const db = getDb()
  const rows = db.select().from(schema.sourceConnection).all()
  const bySource = new Map(rows.map(r => [r.source, r]))
  return ALL_SOURCES.map((source) => {
    const r = bySource.get(source)
    return {
      source,
      label: SOURCE_META[source].label,
      credentialLabel: SOURCE_META[source].credentialLabel,
      probeHint: SOURCE_META[source].probeHint,
      baseUrl: r?.baseUrl ?? '',
      hasCredential: !!r?.credential,
      enabled: r?.enabled === 1,
      lastStatus: r?.lastStatus ?? 'untested',
      lastError: r?.lastError ?? null,
      lastTestedAt: r?.lastTestedAt ?? null,
      lastSyncedAt: r?.lastSyncedAt ?? null
    }
  })
})
