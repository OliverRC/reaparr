import { describe, it, expect } from 'vitest'
import { matchesTitleQuery } from '../../app/utils/format'

describe('matchesTitleQuery', () => {
  it('matches everything when the query is empty', () => {
    expect(matchesTitleQuery('The Sandman', '')).toBe(true)
  })

  it('matches everything when the query is whitespace only', () => {
    expect(matchesTitleQuery('The Sandman', '   ')).toBe(true)
  })

  it('matches case-insensitively', () => {
    expect(matchesTitleQuery('The Sandman', 'sand')).toBe(true)
  })

  it('matches a substring anywhere in the title', () => {
    expect(matchesTitleQuery('The Sandman', 'man')).toBe(true)
  })

  it('returns false when the query is not a substring', () => {
    expect(matchesTitleQuery('The Sandman', 'xyz')).toBe(false)
  })

  it('trims surrounding whitespace before matching', () => {
    expect(matchesTitleQuery('The Sandman', ' sand ')).toBe(true)
  })
})
