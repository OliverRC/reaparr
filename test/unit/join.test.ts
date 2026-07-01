import { describe, it, expect } from 'vitest'
import { buildTitleIndex, matchTitle, type TitleRef } from '../../server/sync/join'

const titles: TitleRef[] = [
  { id: 1, mediaType: 'series', tvdbId: 81189, tmdbId: 1396, imdbId: 'tt0903747' }, // Breaking Bad
  { id: 2, mediaType: 'movie', tmdbId: 27205, imdbId: 'tt1375666' }, // Inception
  { id: 3, mediaType: 'series', tvdbId: 121361, tmdbId: 1399 } // GoT
]
const index = buildTitleIndex(titles)

describe('title join on external IDs', () => {
  it('joins a series request on tvdbId', () => {
    expect(matchTitle({ mediaType: 'series', tvdbId: 81189 }, index)).toBe(1)
  })
  it('joins a movie request on tmdbId', () => {
    expect(matchTitle({ mediaType: 'movie', tmdbId: 27205 }, index)).toBe(2)
  })
  it('joins a Tautulli watch via imdb guid when tmdb/tvdb missing', () => {
    expect(matchTitle({ mediaType: 'movie', imdbId: 'TT1375666' }, index)).toBe(2)
  })
  it('falls back tmdb→tvdb for series when tvdb absent', () => {
    expect(matchTitle({ mediaType: 'series', tmdbId: 1399 }, index)).toBe(3)
  })
  it('returns null when nothing matches', () => {
    expect(matchTitle({ mediaType: 'movie', tmdbId: 999999 }, index)).toBeNull()
  })
})
