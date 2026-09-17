import { describe, expect, it } from 'vitest'

import {
  addPointToScore,
  gameRules,
  isGameWon,
  isWinningScore,
  matchGameTally,
  matchWinnerSide,
} from './scoring'
import type { Game, Score } from './types'

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
    { a: 20, b: 18 },
    { a: 19, b: 17 },
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
    expect(isWinningScore(reverse(score))).toBe(false)
  })
})

describe('addPointToScore', () => {
  it('allows deuce to continue until a two-point margin', () => {
    expect(addPointToScore({ a: 20, b: 20 }, 'a')).toEqual({ a: 21, b: 20 })
    expect(addPointToScore({ a: 21, b: 20 }, 'a')).toEqual({ a: 22, b: 20 })
  })

  it('continues point entry from a pre-21 two-point margin symmetrically', () => {
    expect(addPointToScore({ a: 20, b: 18 }, 'a')).toEqual({ a: 21, b: 18 })
    expect(addPointToScore({ a: 18, b: 20 }, 'b')).toEqual({ a: 18, b: 21 })
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

describe('team tournament game rules', () => {
  it('uses 15/21 for group and third place, and 21/30 for the final', () => {
    expect(gameRules('group')).toEqual({ target: 15, cap: 21 })
    expect(gameRules('third-place')).toEqual({ target: 15, cap: 21 })
    expect(gameRules('final')).toEqual({ target: 21, cap: 30 })
  })

  it.each([
    ['group', { a: 15, b: 13 }, true],
    ['group', { a: 15, b: 14 }, false],
    ['group', { a: 20, b: 19 }, false],
    ['group', { a: 21, b: 20 }, true],
    ['group', { a: 21, b: 19 }, true],
    ['third-place', { a: 21, b: 20 }, true],
    ['third-place', { a: 21, b: 19 }, true],
    ['final', { a: 21, b: 19 }, true],
    ['final', { a: 21, b: 20 }, false],
    ['final', { a: 29, b: 28 }, false],
    ['final', { a: 30, b: 29 }, true],
    ['final', { a: 30, b: 28 }, true],
  ] as const)('validates %s score %o as %s', (stage, score, expected) => {
    expect(isGameWon(score, stage)).toBe(expected)
    expect(isGameWon(reverse(score), stage)).toBe(expected)
  })

  it('counts only confirmed games and ends a match at two legal game wins', () => {
    const games: Game[] = [
      {
        gameNumber: 1,
        score: { a: 15, b: 12 },
        confirmedAt: '2026-09-17T01:00:00Z',
      },
      {
        gameNumber: 2,
        score: { a: 10, b: 15 },
        confirmedAt: '2026-09-17T01:10:00Z',
      },
      {
        gameNumber: 3,
        score: { a: 21, b: 20 },
        confirmedAt: '2026-09-17T01:20:00Z',
      },
    ]

    expect(matchGameTally(games)).toEqual({ a: 2, b: 1 })
    expect(matchWinnerSide(games, 'group')).toBe('a')
    expect(matchWinnerSide(games, 'final')).toBeNull()
    expect(
      matchWinnerSide(
        [
          { ...games[0], score: { a: 21, b: 19 } },
          { ...games[1], score: { a: 19, b: 21 } },
          { ...games[2], score: { a: 30, b: 29 } },
        ],
        'final',
      ),
    ).toBe('a')
  })
})
