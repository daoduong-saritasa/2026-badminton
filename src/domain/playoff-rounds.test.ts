import { describe, expect, it } from 'vitest'

import { resolvePlayoffRound, type PlayoffRound } from './playoff-rounds'
import type { FixtureMatch, Score, TeamFixture } from './types'

function fixture(id: string, teamAId: string, teamBId: string): TeamFixture {
  return {
    id,
    stage: 'qualification-playoff',
    teamAId,
    teamBId,
    version: 1,
  }
}

function played(
  owner: TeamFixture,
  score: Score,
  resultKind: 'played' | 'walkover' = 'played',
): FixtureMatch {
  return {
    id: `match-${owner.id}`,
    fixtureId: owner.id,
    matchNumber: 1,
    pairA: null,
    pairB: null,
    court: null,
    state: 'completed',
    resultKind,
    winnerSide: score.a > score.b ? 'a' : 'b',
    games: resultKind === 'played'
      ? [{ gameNumber: 1, score, confirmedAt: '2026-09-22T00:00:00Z' }]
      : [],
    version: 1,
  }
}

function round(
  teamIds: string[],
  fixtureIds: string[],
  overrides: Partial<PlayoffRound> = {},
): PlayoffRound {
  return {
    id: 'round-1',
    roundNumber: 1,
    teamIds,
    fixedFinalistIds: [],
    availablePlaces: 2,
    fixtureIds,
    ...overrides,
  }
}

function tiedMiniRoundRobin(prefix = 'r1') {
  const f12 = fixture(`${prefix}-12`, 't1', 't2')
  const f13 = fixture(`${prefix}-13`, 't1', 't3')
  const f23 = fixture(`${prefix}-23`, 't2', 't3')
  return {
    fixtures: [f12, f13, f23],
    matches: [
      played(f12, { a: 11, b: 9 }),
      played(f13, { a: 9, b: 11 }),
      played(f23, { a: 11, b: 9 }),
    ],
  }
}

describe('resolvePlayoffRound', () => {
  it('replays all three teams when a mini round robin remains fully tied', () => {
    const current = tiedMiniRoundRobin()

    expect(resolvePlayoffRound(
      round(['t1', 't2', 't3'], current.fixtures.map(({ id }) => id)),
      current.fixtures,
      current.matches,
    )).toEqual({
      finalistIds: [],
      nextRound: {
        teamIds: ['t1', 't2', 't3'],
        fixedFinalistIds: [],
        availablePlaces: 2,
      },
    })
  })

  it('resolves a two-team continuation for the remaining place', () => {
    const continuation = fixture('continuation', 't2', 't3')

    expect(resolvePlayoffRound(
      round(['t2', 't3'], [continuation.id], {
        fixedFinalistIds: ['t1'],
        availablePlaces: 1,
      }),
      [continuation],
      [played(continuation, { a: 9, b: 11 })],
    )).toEqual({ finalistIds: ['t1', 't3'], nextRound: null })
  })

  it('carries a fixed finalist through repeated tied rounds', () => {
    const first = tiedMiniRoundRobin('r1')
    const firstOutcome = resolvePlayoffRound(
      round(['t1', 't2', 't3'], first.fixtures.map(({ id }) => id), {
        fixedFinalistIds: ['fixed'],
        availablePlaces: 1,
      }),
      first.fixtures,
      first.matches,
    )
    expect(firstOutcome?.nextRound).toEqual({
      teamIds: ['t1', 't2', 't3'],
      fixedFinalistIds: ['fixed'],
      availablePlaces: 1,
    })

    const second = tiedMiniRoundRobin('r2')
    expect(resolvePlayoffRound(
      round(firstOutcome?.nextRound?.teamIds ?? [], second.fixtures.map(({ id }) => id), {
        id: 'round-2',
        roundNumber: 2,
        fixedFinalistIds: firstOutcome?.nextRound?.fixedFinalistIds ?? [],
        availablePlaces: firstOutcome?.nextRound?.availablePlaces ?? 1,
      }),
      second.fixtures,
      second.matches,
    )?.nextRound?.fixedFinalistIds).toEqual(['fixed'])
  })

  it('ranks only fixtures belonging to the current round', () => {
    const historical = fixture('historical', 't1', 't2')
    const current = tiedMiniRoundRobin('current')

    expect(resolvePlayoffRound(
      round(['t1', 't2', 't3'], current.fixtures.map(({ id }) => id)),
      [historical, ...current.fixtures],
      [played(historical, { a: 15, b: 0 }), ...current.matches],
    )?.nextRound?.teamIds).toEqual(['t1', 't2', 't3'])
  })

  it('returns null until every fixture in the round resolves', () => {
    const current = tiedMiniRoundRobin()
    const unfinished = { ...current.matches[2], state: 'playing', winnerSide: null } as const

    expect(resolvePlayoffRound(
      round(['t1', 't2', 't3'], current.fixtures.map(({ id }) => id)),
      current.fixtures,
      [...current.matches.slice(0, 2), unfinished],
    )).toBeNull()
  })

  it('advances both winners from a four-team matchup draw', () => {
    const first = fixture('semi-1', 't1', 't2')
    const second = fixture('semi-2', 't3', 't4')

    expect(resolvePlayoffRound(
      round(['t1', 't2', 't3', 't4'], [first.id, second.id]),
      [first, second],
      [played(first, { a: 11, b: 5 }), played(second, { a: 7, b: 11 })],
    )).toEqual({ finalistIds: ['t1', 't4'], nextRound: null })
  })

  it('counts a walkover win without adding artificial points', () => {
    const f12 = fixture('walkover-12', 't1', 't2')
    const f13 = fixture('walkover-13', 't1', 't3')
    const f23 = fixture('walkover-23', 't2', 't3')

    expect(resolvePlayoffRound(
      round(['t1', 't2', 't3'], [f12.id, f13.id, f23.id], { availablePlaces: 1 }),
      [f12, f13, f23],
      [
        played(f12, { a: 1, b: 0 }, 'walkover'),
        played(f13, { a: 10, b: 12 }),
        played(f23, { a: 11, b: 0 }),
      ],
    )).toEqual({ finalistIds: ['t2'], nextRound: null })
  })
})
