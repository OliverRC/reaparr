// Reaping Workflow state machine (docs/adr/0001, 0003). Every reaping state change flows through
// applyTransition(), which validates the transition, enforces the actor invariant, writes an
// append-only title_transition row, and updates the denormalized title.state — all in one
// transaction. Functional names only; the Death voice is a frontend concern (never imported here).

import { eq } from 'drizzle-orm'
import type { getDb } from '../db/client'
import { schema } from '../db/client'

export type ReapState = 'eligible' | 'scheduled' | 'appealed' | 'due' | 'removed'

export type TransitionReason
  = | 'admin_scheduled'
    | 'member_appealed'
    | 'appeal_granted'
    | 'appeal_denied'
    | 'admin_cancelled'
    | 'auto_reprieve_watched'
    | 'grace_elapsed'
    | 'admin_marked_removed'
    | 'sync_confirmed_removed'
    | 'resurrected'

// A transition is caused by exactly one actor: a person (human action) OR the system.
export type Actor = { personId: number } | { system: 'sync' | 'system' }

export const REASONS: ReadonlySet<string> = new Set<TransitionReason>([
  'admin_scheduled', 'member_appealed', 'appeal_granted', 'appeal_denied', 'admin_cancelled',
  'auto_reprieve_watched', 'grace_elapsed', 'admin_marked_removed', 'sync_confirmed_removed', 'resurrected'
])

// Allowed (from → to) edges. reprieve and resurrection are transitions, not states.
export const ALLOWED: Readonly<Record<ReapState, ReadonlyArray<ReapState>>> = {
  // eligible → removed covers an out-of-band deletion of a never-scheduled title (sync tombstone).
  eligible: ['scheduled', 'removed'],
  scheduled: ['appealed', 'eligible', 'due', 'removed'],
  appealed: ['scheduled', 'eligible', 'removed'], // NOT 'due' — an open appeal blocks the Appointed Hour
  due: ['eligible', 'removed'],
  removed: ['eligible'] // resurrection
}

export function canTransition(from: ReapState, to: ReapState): boolean {
  return ALLOWED[from]?.includes(to) ?? false
}

type Db = ReturnType<typeof getDb>

export interface TransitionInput {
  to: ReapState
  reason: TransitionReason
  actor: Actor
  metadata?: Record<string, unknown>
  // Extra title columns to set atomically with the transition (e.g. schedule clock fields).
  patch?: Partial<{ scheduledAt: string | null, dueAt: string | null, sendReminder: number }>
  now?: number
}

export interface TransitionResult {
  titleId: number
  fromState: ReapState
  toState: ReapState
  episode: number
}

function isValidActor(actor: Actor): boolean {
  const hasPerson = 'personId' in actor && actor.personId != null
  const hasSystem = 'system' in actor && actor.system != null
  return hasPerson !== hasSystem // exactly one
}

/**
 * Apply a reaping state transition to a title. Throws on an illegal (from,to) edge, an unknown
 * reason, a bad actor, or an unknown title. Writes the log row and the denormalized state together.
 */
export function applyTransition(db: Db, titleId: number, input: TransitionInput): TransitionResult {
  const { to, reason, actor, metadata, patch } = input
  const now = input.now ?? Date.now()
  const nowIso = new Date(now).toISOString()

  if (!REASONS.has(reason)) throw new Error(`Unknown transition reason: ${reason}`)
  if (!isValidActor(actor)) throw new Error('Transition actor must be exactly one of person or system')

  return db.transaction((tx) => {
    const row = tx.select({ state: schema.title.state, episode: schema.title.episode })
      .from(schema.title).where(eq(schema.title.id, titleId)).get()
    if (!row) throw new Error(`Unknown title: ${titleId}`)

    const fromState = row.state as ReapState
    if (!canTransition(fromState, to)) {
      throw new Error(`Illegal transition ${fromState} → ${to} (title ${titleId})`)
    }

    const newEpisode = reason === 'resurrected' ? row.episode + 1 : row.episode

    // Base column updates driven by the target state.
    const set: Record<string, unknown> = { state: to, episode: newEpisode }
    if (to === 'removed') {
      set.removedAt = nowIso
    } else if (to === 'eligible') {
      // Returning to the pool (reprieve, cancel, resurrection) resets the clock and tombstone.
      set.scheduledAt = null
      set.dueAt = null
      set.sendReminder = 0
      set.removedAt = null
    }
    // Caller-supplied clock fields (e.g. schedule) win, applied last.
    if (patch) Object.assign(set, patch)

    tx.insert(schema.titleTransition).values({
      titleId,
      episode: newEpisode,
      fromState,
      toState: to,
      reason,
      actorPersonId: 'personId' in actor ? actor.personId : null,
      actorSystem: 'system' in actor ? actor.system : null,
      metadata: metadata ? JSON.stringify(metadata) : null,
      createdAt: nowIso
    }).run()

    tx.update(schema.title).set(set).where(eq(schema.title.id, titleId)).run()

    return { titleId, fromState, toState: to, episode: newEpisode }
  })
}
