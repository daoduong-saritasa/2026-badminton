import { describe, expect, it } from 'vitest'

import {
  correctedMatchWinner,
  gameRules,
  gamesToWinMatch,
  isGameWon,
  matchGameTally,
  matchWinnerSide,
} from './scoring'
import type { Game, Score } from './types'

function reverse(score: Score): Score {
  return { a: score.b, b: score.a }
}

function confirmed(gameNumber: number, score: Score): Game {
  return { gameNumber, score, confirmedAt: '2026-09-17T01:00:00Z' }
}

describe('team tournament game rules', () => {
  it('uses 11/15 for qualification playoffs, 15/21 for third place, and 21/30 otherwise', () => {
    expect(gameRules('qualifying')).toEqual({ target: 21, cap: 30 })
    expect(gameRules('qualification-playoff')).toEqual({ target: 11, cap: 15 })
    expect(gameRules('third-place')).toEqual({ target: 15, cap: 21 })
    expect(gameRules('final')).toEqual({ target: 21, cap: 30 })
  })

  it('plays placement matches as best of three and every other match as one game', () => {
    expect(gamesToWinMatch('qualifying')).toBe(1)
    expect(gamesToWinMatch('qualification-playoff')).toBe(1)
    expect(gamesToWinMatch('third-place')).toBe(2)
    expect(gamesToWinMatch('final')).toBe(2)
  })

  it.each([
    ['qualifying', { a: 21, b: 19 }, true],
    ['qualifying', { a: 21, b: 20 }, false],
    ['qualifying', { a: 29, b: 28 }, false],
    ['qualifying', { a: 30, b: 29 }, true],
    ['qualifying', { a: 15, b: 13 }, false],
    ['qualification-playoff', { a: 11, b: 9 }, true],
    ['qualification-playoff', { a: 11, b: 10 }, false],
    ['qualification-playoff', { a: 13, b: 11 }, true],
    ['qualification-playoff', { a: 14, b: 13 }, false],
    ['qualification-playoff', { a: 15, b: 14 }, true],
    ['qualification-playoff', { a: 16, b: 14 }, false],
    ['third-place', { a: 15, b: 13 }, true],
    ['third-place', { a: 15, b: 14 }, false],
    ['third-place', { a: 17, b: 15 }, true],
    ['third-place', { a: 20, b: 19 }, false],
    ['third-place', { a: 21, b: 20 }, true],
    ['third-place', { a: 21, b: 19 }, true],
    ['third-place', { a: 22, b: 20 }, false],
    ['third-place', { a: 30, b: 29 }, false],
    ['final', { a: 21, b: 19 }, true],
    ['final', { a: 30, b: 28 }, true],
  ] as const)('validates %s score %o as %s', (stage, score, expected) => {
    expect(isGameWon(score, stage)).toBe(expected)
    expect(isGameWon(reverse(score), stage)).toBe(expected)
  })

  it('decides a one-game match on its single confirmed game', () => {
    expect(matchWinnerSide([confirmed(1, { a: 19, b: 21 })], 'qualifying')).toBe('b')
    expect(matchWinnerSide([confirmed(1, { a: 11, b: 7 })], 'qualification-playoff')).toBe('a')
    expect(
      matchWinnerSide([{ ...confirmed(1, { a: 21, b: 10 }), confirmedAt: null }], 'third-place'),
    ).toBeNull()
  })

  it('counts only confirmed games and ends a final at two legal game wins', () => {
    const games: Game[] = [
      confirmed(1, { a: 21, b: 19 }),
      confirmed(2, { a: 19, b: 21 }),
      { ...confirmed(3, { a: 30, b: 29 }), confirmedAt: null },
    ]

    expect(matchGameTally(games)).toEqual({ a: 1, b: 1 })
    expect(matchWinnerSide(games, 'final')).toBeNull()
    expect(
      matchWinnerSide([...games.slice(0, 2), confirmed(3, { a: 30, b: 29 })], 'final'),
    ).toBe('a')
  })
})

describe('correctedMatchWinner', () => {
  it('returns the side that won the games the stage requires', () => {
    expect(correctedMatchWinner([{ a: 21, b: 10 }], 'qualifying')).toBe('a')
    expect(correctedMatchWinner([{ a: 9, b: 11 }], 'qualification-playoff')).toBe('b')
    expect(correctedMatchWinner([{ a: 21, b: 10 }, { a: 12, b: 21 }, { a: 19, b: 21 }], 'final')).toBe('b')
    expect(correctedMatchWinner([{ a: 21, b: 20 }, { a: 15, b: 9 }], 'third-place')).toBe('a')
  })

  it('rejects an invalid game, an unfinished match, and a game after the match was decided', () => {
    expect(correctedMatchWinner([{ a: 21, b: 20 }], 'qualifying')).toBeNull()
    expect(correctedMatchWinner([], 'third-place')).toBeNull()
    expect(correctedMatchWinner([{ a: 15, b: 10 }], 'third-place')).toBeNull()
    expect(correctedMatchWinner([{ a: 21, b: 10 }, { a: 21, b: 10 }], 'qualifying')).toBeNull()
    expect(correctedMatchWinner([{ a: 21, b: 10 }], 'final')).toBeNull()
    expect(correctedMatchWinner([{ a: 21, b: 10 }, { a: 21, b: 10 }, { a: 10, b: 21 }], 'final')).toBeNull()
  })
})
