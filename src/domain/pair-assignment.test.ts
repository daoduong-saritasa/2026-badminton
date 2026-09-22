import { describe, expect, it } from 'vitest'

import {
  pairingRule,
  qualifyingPairings,
  validatePairAssignment,
} from './pair-assignment'
import type {
  FixtureMatch,
  FixtureStage,
  Pair,
  TeamFixture,
  TeamPlayer,
  TournamentSnapshot,
} from './types'

const players: TeamPlayer[] = [
  { id: 'a1', teamId: 'a', name: 'A1', seed: 1 },
  { id: 'a2', teamId: 'a', name: 'A2', seed: 1 },
  { id: 'a3', teamId: 'a', name: 'A3', seed: 2 },
  { id: 'a4', teamId: 'a', name: 'A4', seed: 2 },
  { id: 'b1', teamId: 'b', name: 'B1', seed: 1 },
  { id: 'b2', teamId: 'b', name: 'B2', seed: 2 },
]

const pair = (player1Id: string, player2Id: string): Pair => ({ player1Id, player2Id })

function fixture(stage: FixtureStage, id: string = stage): TeamFixture {
  return { id, stage, teamAId: 'a', teamBId: 'b', version: 1 }
}

function match(
  owner: TeamFixture,
  matchNumber: 1 | 2 | 3,
  overrides: Partial<FixtureMatch> = {},
): FixtureMatch {
  return {
    id: `${owner.id}-${matchNumber}`,
    fixtureId: owner.id,
    matchNumber,
    pairA: null,
    pairB: null,
    court: null,
    state: 'unstarted',
    resultKind: null,
    winnerSide: null,
    games: [],
    version: 1,
    ...overrides,
  }
}

function snapshot(
  fixtures: TeamFixture[],
  matches: FixtureMatch[],
): TournamentSnapshot {
  return {
    tournament: {
      id: 'tournament',
      name: 'Tournament',
      stage: 'groups',
      setupLockedAt: '2026-09-22T00:00:00Z',
      version: 1,
      resultRevision: 1,
      finalistsConfirmedAt: null,
      currentPlayoffRoundId: null,
    },
    teams: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    players,
    fixtures,
    matches,
    playoffRounds: [],
  }
}

describe('pairingRule', () => {
  it.each([
    ['qualifying', 1, 'mixed-seed'],
    ['qualifying', 2, 'mixed-seed'],
    ['third-place', 1, 'mixed-seed'],
    ['third-place', 2, 'mixed-seed'],
    ['third-place', 3, 'free'],
    ['final', 1, 'free'],
    ['final', 3, 'free'],
    ['qualification-playoff', 1, 'free'],
  ] as const)('uses %s match %d as %s', (stage, matchNumber, expected) => {
    expect(pairingRule(stage, matchNumber)).toBe(expected)
  })
})

describe('qualifyingPairings', () => {
  it('returns both disjoint mixed-seed arrangements deterministically', () => {
    expect(qualifyingPairings([...players].reverse(), 'a')).toEqual([
      [pair('a1', 'a3'), pair('a2', 'a4')],
      [pair('a1', 'a4'), pair('a2', 'a3')],
    ])
  })

  it('returns no arrangement for an invalid roster', () => {
    expect(qualifyingPairings(players.filter(({ id }) => id !== 'a4'), 'a')).toEqual([])
  })
})

describe('validatePairAssignment', () => {
  it('accepts either mixed pair and permits the same arrangement in another fixture', () => {
    const first = fixture('qualifying', 'q1')
    const second = fixture('qualifying', 'q2')
    const state = snapshot(
      [first, second],
      [
        match(first, 1, { pairA: pair('a1', 'a3') }),
        match(first, 2, { pairA: pair('a2', 'a4') }),
        match(second, 1),
        match(second, 2),
      ],
    )

    expect(validatePairAssignment(state, 'q2-1', 'a', pair('a1', 'a3'))).toEqual([])
    expect(validatePairAssignment(state, 'q2-1', 'a', pair('a1', 'a4'))).toEqual([])
  })

  it('marks qualifying reuse in the sibling match as overridable', () => {
    const owner = fixture('qualifying')
    const state = snapshot(
      [owner],
      [match(owner, 1, { pairA: pair('a1', 'a3') }), match(owner, 2)],
    )

    expect(validatePairAssignment(state, 'qualifying-2', 'a', pair('a1', 'a4')))
      .toContainEqual({ code: 'qualifying-player-reused', overridable: true })
  })

  it('marks same-seed pairs as overridable only where mixed seeds are required', () => {
    const qualifying = fixture('qualifying')
    const thirdPlace = fixture('third-place')
    const final = fixture('final')
    const playoff = fixture('qualification-playoff')
    const state = snapshot(
      [qualifying, thirdPlace, final, playoff],
      [
        match(qualifying, 1),
        match(thirdPlace, 1),
        match(thirdPlace, 3),
        match(final, 1),
        match(playoff, 1),
      ],
    )

    expect(validatePairAssignment(state, 'qualifying-1', 'a', pair('a1', 'a2')))
      .toContainEqual({ code: 'same-seed', overridable: true })
    expect(validatePairAssignment(state, 'third-place-1', 'a', pair('a1', 'a2')))
      .toContainEqual({ code: 'same-seed', overridable: true })
    expect(validatePairAssignment(state, 'third-place-3', 'a', pair('a1', 'a2'))).toEqual([])
    expect(validatePairAssignment(state, 'final-1', 'a', pair('a1', 'a2'))).toEqual([])
    expect(validatePairAssignment(state, 'qualification-playoff-1', 'a', pair('a1', 'a2')))
      .toEqual([])
  })

  it('never permits duplicate, unknown, or opposing-team players', () => {
    const owner = fixture('final')
    const state = snapshot([owner], [match(owner, 1)])

    expect(validatePairAssignment(state, 'final-1', 'a', pair('a1', 'a1')))
      .toContainEqual({ code: 'duplicate-player', overridable: false })
    expect(validatePairAssignment(state, 'final-1', 'a', pair('missing', 'a3')))
      .toContainEqual({ code: 'unknown-player', overridable: false })
    expect(validatePairAssignment(state, 'final-1', 'a', pair('a1', 'b1')))
      .toContainEqual({ code: 'wrong-team', overridable: false })
  })

  it('blocks a player already playing on any court', () => {
    const target = fixture('final')
    const active = fixture('qualifying', 'active')
    const state = snapshot(
      [target, active],
      [
        match(target, 1),
        match(active, 1, {
          pairB: pair('b1', 'b2'),
          pairA: pair('a1', 'a3'),
          court: 2,
          state: 'playing',
        }),
      ],
    )

    expect(validatePairAssignment(state, 'final-1', 'a', pair('a1', 'a4')))
      .toContainEqual({ code: 'player-playing', overridable: false })
  })
})
