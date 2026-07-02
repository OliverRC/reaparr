// Death's voice as a frontend display map (docs/adr/0001). Keyed by the FUNCTIONAL enums the backend
// emits (lifecycle `state`, notification `event`, transition `reason`) — the backend never imports
// this. Swapping this file for a plain-language or localized map is the whole cost of a voice toggle.
//
// State badges and headline/empty-state copy wear the voice (spec §11). History timelines are
// functional UI, so `reasonLabel` stays neutral and descriptive (CLAUDE.md R9).

export interface StateVoice {
  label: string // Death's register (small caps rendered by the UI)
  color: 'neutral' | 'warning' | 'error' | 'success'
}

// Functional state → voice label + badge tone.
export function stateVoice(state: string): StateVoice {
  switch (state) {
    case 'scheduled': return { label: 'The Sands', color: 'warning' }
    case 'appealed': return { label: 'Appeal Raised', color: 'warning' }
    case 'due': return { label: 'The Appointed Hour', color: 'error' }
    case 'removed': return { label: 'Departed', color: 'neutral' }
    default: return { label: 'Eligible', color: 'success' }
  }
}

// Headlines, empty states, and confirmations (spec §11). Small-caps rendering is the UI's job.
export const VOICE = {
  theSands: 'THE SANDS',
  appointedHour: 'THE APPOINTED HOUR',
  scheduleConfirm: 'AN APPOINTMENT HAS BEEN MADE.',
  objected: 'NOTED. THE MATTER WILL BE CONSIDERED.',
  reprieveGranted: 'IT WILL STAY. FOR NOW.',
  emptySands: 'THERE IS NOTHING IN THE SANDS.',
  emptyDue: 'THERE IS NOTHING HERE FOR ME. YET.',
  departed: 'IT HAS PASSED.'
} as const

// Neutral, functional labels for the transition history timeline (NOT voiced — R9).
export function reasonLabel(reason: string): string {
  switch (reason) {
    case 'admin_scheduled': return 'Scheduled for reaping'
    case 'member_appealed': return 'Appeal raised'
    case 'appeal_granted': return 'Appeal granted — reprieved'
    case 'appeal_denied': return 'Appeal denied'
    case 'appeal_withdrawn': return 'Appeal withdrawn'
    case 'admin_cancelled': return 'Cancelled'
    case 'auto_reprieve_watched': return 'Reprieved — watched during grace'
    case 'grace_elapsed': return 'Grace elapsed — due'
    case 'admin_marked_removed': return 'Marked removed'
    case 'sync_confirmed_removed': return 'Removal confirmed by sync'
    case 'resurrected': return 'Resurrected'
    default: return reason
  }
}
