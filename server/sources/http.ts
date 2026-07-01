// Shared fetch wrapper for source adapters: auth injection, timeout, and
// credential redaction from any logged URL (critical for Tautulli's query-string key).

import type { AuthInjection, ConnectionConfig } from './types'

const DEFAULT_TIMEOUT_MS = 15_000

export class SourceHttpError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'SourceHttpError'
    this.status = status
  }
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return b + p
}

/** Strip known credential values from a URL for safe logging. */
export function redactUrl(url: string, credential?: string): string {
  let out = url
  // Redact apikey/api_key query params regardless of source.
  out = out.replace(/([?&](?:apikey|api_key|x-api-key)=)[^&#]*/gi, '$1••••')
  if (credential && credential.length > 0) {
    out = out.split(credential).join('••••')
  }
  return out
}

export interface FetchOptions {
  query?: Record<string, string | number | undefined>
  timeoutMs?: number
}

export async function sourceFetch<T = unknown>(
  config: ConnectionConfig,
  auth: AuthInjection,
  path: string,
  opts: FetchOptions = {}
): Promise<T> {
  if (!config.baseUrl) throw new SourceHttpError('No base URL configured')

  const url = new URL(joinUrl(config.baseUrl, path))
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v))
  }

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (auth.kind === 'header') {
    headers[auth.name] = config.credential
  } else {
    url.searchParams.set(auth.param, config.credential)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers, signal: controller.signal })
    if (!res.ok) {
      throw new SourceHttpError(`HTTP ${res.status} for ${redactUrl(url.toString(), config.credential)}`, res.status)
    }
    const text = await res.text()
    if (!text) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      throw new SourceHttpError(`Invalid JSON from ${redactUrl(url.toString(), config.credential)}`)
    }
  } catch (err) {
    if (err instanceof SourceHttpError) throw err
    if ((err as Error)?.name === 'AbortError') {
      throw new SourceHttpError(`Timed out after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`)
    }
    throw new SourceHttpError(`${(err as Error)?.message ?? 'Request failed'} (${redactUrl(url.toString(), config.credential)})`)
  } finally {
    clearTimeout(timeout)
  }
}
