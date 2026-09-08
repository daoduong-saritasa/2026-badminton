import { describe, expect, it } from 'vitest'

import { addPointToScore, isWinningScore } from './scoring'
import type { Score } from './types'

function reverse(score: Score): Score {
  return { a: score.b, b: score.a }
}

describe('isWinningScore', () => {
  it.each<Score>([
    { a: 21, b: 0 },
    { a: 21, b: 19 },
    { a: 22, b: 20 },
    { a: 29, b: 27 },
    { a: 30, b: 28 },
    { a: 30, b: 29 },
  ])('accepts completed score $a–$b symmetrically', (score) => {
    expect(isWinningScore(score)).toBe(true)
    expect(isWinningScore(reverse(score))).toBe(true)
  })

  it.each<Score>([
    { a: 0, b: 0 },
    { a: 20, b: 19 },
    { a: 21, b: 20 },
    { a: 22, b: 19 },
    { a: 29, b: 28 },
    { a: 30, b: 27 },
    { a: 30, b: 30 },
    { a: 31, b: 29 },
    { a: -1, b: 21 },
    { a: 21.5, b: 19.5 },
  ])('rejects impossible or unfinished score $a–$b', (score) => {
    expect(isWinningScore(score)).toBe(false)
  })
})

describe('addPointToScore', () => {
  it('allows deuce to continue until a two-point margin', () => {
    expect(addPointToScore({ a: 20, b: 20 }, 'a')).toEqual({ a: 21, b: 20 })
    expect(addPointToScore({ a: 21, b: 20 }, 'a')).toEqual({ a: 22, b: 20 })
  })

  it('stops point entry after a normal win', () => {
    const completed = { a: 21, b: 19 }

    expect(addPointToScore(completed, 'a')).toBe(completed)
    expect(addPointToScore(completed, 'b')).toBe(completed)
  })

  it('stops point entry at the 30-point cap', () => {
    const completed = { a: 30, b: 29 }

    expect(addPointToScore(completed, 'a')).toBe(completed)
    expect(addPointToScore(completed, 'b')).toBe(completed)
  })
})
