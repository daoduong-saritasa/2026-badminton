import { describe, expect, it } from 'vitest'

import {
  gameRules,
  isGameWon,
  matchGameTally,
  matchWinnerSide,
} from './scoring'
import type { Game, Score } from './types'

function reverse(score: Score): Score {
  return { a: score.b, b: score.a }
}

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
