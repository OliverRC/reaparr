import { describe, it, expect } from 'vitest'
import { stateVoice, reasonLabel, VOICE } from '../../app/utils/voice'

describe('voice display map', () => {
  it('maps each functional state to its Death-voice label and tone', () => {
    expect(stateVoice('scheduled').label).toBe('The Sands')
    expect(stateVoice('appealed').label).toBe('Appeal Raised')
    expect(stateVoice('due').label).toBe('The Appointed Hour')
    expect(stateVoice('removed').label).toBe('Departed')
    expect(stateVoice('eligible').label).toBe('Eligible')
    // unknown falls back to Eligible, not a crash
    expect(stateVoice('nonsense').label).toBe('Eligible')
  })

  it('keeps history reason labels neutral and descriptive (not voiced)', () => {
    expect(reasonLabel('grace_elapsed')).toBe('Grace elapsed — due')
    expect(reasonLabel('auto_reprieve_watched')).toBe('Reprieved — watched during grace')
    expect(reasonLabel('resurrected')).toBe('Resurrected')
    // unknown reason passes through rather than throwing
    expect(reasonLabel('brand_new_reason')).toBe('brand_new_reason')
  })

  it('exposes voiced headline/empty-state copy in small-caps register', () => {
    expect(VOICE.appointedHour).toBe('THE APPOINTED HOUR')
    expect(VOICE.scheduleConfirm).toMatch(/APPOINTMENT/)
  })
})
