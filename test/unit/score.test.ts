import { describe, it, expect } from 'vitest'
import { reapScore, stalenessRamp, tierLabel, DEFAULT_SCORING, type TitleFacts } from '../../server/sync/score'

const NOW = Date.parse('2026-06-30T00:00:00Z')
const DAY = 86_400_000
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString()

function facts(p: Partial<TitleFacts>): TitleFacts {
  return {
    mediaType: 'series',
    title: 'Test',
    addedAt: daysAgo(600),
    watched: false,
    lastWatchedAt: null,
    completion: 0,
    requested: false,
    ...p
  }
}

describe('stalenessRamp tiers', () => {
  it('steps at 3/6/12 months', () => {
    expect(stalenessRamp(10, DEFAULT_SCORING)).toBe(0)
    expect(stalenessRamp(89, DEFAULT_SCORING)).toBe(0)
    expect(stalenessRamp(90, DEFAULT_SCORING)).toBeCloseTo(1 / 3)
    expect(stalenessRamp(179, DEFAULT_SCORING)).toBeCloseTo(1 / 3)
    expect(stalenessRamp(180, DEFAULT_SCORING)).toBeCloseTo(2 / 3)
    expect(stalenessRamp(364, DEFAULT_SCORING)).toBeCloseTo(2 / 3)
    expect(stalenessRamp(365, DEFAULT_SCORING)).toBe(1)
    expect(stalenessRamp(900, DEFAULT_SCORING)).toBe(1)
  })
  it('labels tiers', () => {
    expect(tierLabel(10, DEFAULT_SCORING)).toBe('fresh')
    expect(tierLabel(120, DEFAULT_SCORING)).toBe('stale')
    expect(tierLabel(200, DEFAULT_SCORING)).toBe('very_stale')
    expect(tierLabel(500, DEFAULT_SCORING)).toBe('dormant')
  })
})

describe('spec §8.4 worked example', () => {
  it('Some Anime — never watched, requested, ~20mo on server → 100', () => {
    const r = reapScore(facts({
      title: 'Some Anime',
      addedAt: daysAgo(600),
      watched: false,
      completion: 0,
      requested: true
    }), DEFAULT_SCORING, NOW)
    expect(r.S).toBe(50)
    expect(r.A).toBe(30)
    expect(r.R).toBe(20)
    expect(r.freshness).toBe(1)
    expect(r.reap).toBe(100)
  })

  it('A Drama — 14mo idle, ~40% watched, requested & watched → 68', () => {
    const r = reapScore(facts({
      title: 'A Drama',
      addedAt: daysAgo(800),
      watched: true,
      lastWatchedAt: daysAgo(14 * 30), // 420 days ≥ 365 → dormant
      completion: 0.4,
      requested: true
    }), DEFAULT_SCORING, NOW)
    expect(r.S).toBe(50)
    expect(r.A).toBe(18)
    expect(r.R).toBe(0) // watched → request-miss is 0
    expect(r.reap).toBe(68)
  })

  it('A Comedy — finished, watched 3wks ago → 0', () => {
    const r = reapScore(facts({
      title: 'A Comedy',
      addedAt: daysAgo(400),
      watched: true,
      lastWatchedAt: daysAgo(21),
      completion: 1,
      requested: true
    }), DEFAULT_SCORING, NOW)
    expect(r.S).toBe(0)
    expect(r.A).toBe(0)
    expect(r.R).toBe(0)
    expect(r.reap).toBe(0)
  })
})

describe('grace period (freshness)', () => {
  it('brand-new never-watched content ramps in over ~30 days', () => {
    const r = reapScore(facts({
      addedAt: daysAgo(10),
      watched: false,
      completion: 0,
      requested: true
    }), DEFAULT_SCORING, NOW)
    // idle = 10 (since added) → S=0; A=30; R=20; raw=50; freshness=10/30
    expect(r.S).toBe(0)
    expect(r.freshness).toBeCloseTo(10 / 30)
    expect(r.reap).toBe(Math.round(50 * (10 / 30))) // 17
  })

  it('past grace, freshness saturates at 1', () => {
    const r = reapScore(facts({ addedAt: daysAgo(45), requested: true }), DEFAULT_SCORING, NOW)
    expect(r.freshness).toBe(1)
  })
})

describe('never-watched ranks above watched-long-ago (D-7)', () => {
  it('equal idle: never-watched stacks A+R, watched-finished gets staleness only', () => {
    const idle = 500
    const neverWatched = reapScore(facts({
      addedAt: daysAgo(idle), watched: false, completion: 0, requested: true
    }), DEFAULT_SCORING, NOW)
    const watchedFinished = reapScore(facts({
      addedAt: daysAgo(800), watched: true, lastWatchedAt: daysAgo(idle), completion: 1, requested: true
    }), DEFAULT_SCORING, NOW)
    expect(neverWatched.reap).toBe(100)
    expect(watchedFinished.reap).toBe(50)
    expect(neverWatched.reap).toBeGreaterThan(watchedFinished.reap)
  })
})

describe('movie completion scale', () => {
  it('started movie (0.5) yields half abandonment', () => {
    const r = reapScore(facts({
      mediaType: 'movie', addedAt: daysAgo(400), watched: true, lastWatchedAt: daysAgo(400), completion: 0.5
    }), DEFAULT_SCORING, NOW)
    expect(r.A).toBe(15)
    expect(r.S).toBe(50)
    expect(r.reap).toBe(65)
  })
})
