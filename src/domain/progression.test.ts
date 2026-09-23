import { describe, expect, it } from 'vitest'

import {
  correctionBlockCode,
  finalPositions,
  isQualifyingComplete,
  isTournamentComplete,
  placementParticipants,
  resolvedFinalists,
  type ProgressionState,
} from './progression'
import type { PlayoffRound } from './playoff-rounds'
import type {
  FixtureMatch,
  FixtureStage,
  Score,
  Team,
  TeamFixture,
  Tournament,
} from './types'

const teams: Team[] = [
  { id: 't1', name: 'One' },
  { id: 't2', name: 'Two' },
  { id: 't3', name: 'Three' },
  { id: 't4', name: 'Four' },
]

const tournament: Tournament = {
  id: 'tournament',
  name: 'Cup',
  stage: 'groups',
  setupLockedAt: '2026-09-21T00:00:00Z',
  version: 1,
  resultRevision: 1,
  finalistsConfirmedAt: null,
  currentPlayoffRoundId: null,
}

function fixture(
  stage: FixtureStage,
  teamAId: string | null,
  teamBId: string | null,
  suffix = '',
): TeamFixture {
  return { id: `${stage}-${teamAId}-${teamBId}${suffix}`, stage, teamAId, teamBId, version: 1 }
}

function match(
  owner: TeamFixture,
  matchNumber: 1 | 2 | 3,
  winnerSide: 'a' | 'b' | null,
  state: FixtureMatch['state'] = winnerSide ? 'completed' : 'unstarted',
  score: Score = winnerSide === 'a' ? { a: 21, b: 10 } : { a: 10, b: 21 },
): FixtureMatch {
  return {
    id: `${owner.id}-${matchNumber}`,
    fixtureId: owner.id,
    matchNumber,
    state,
    resultKind: winnerSide ? 'played' : null,
    winnerSide,
    games: winnerSide
      ? [{ gameNumber: 1, score, confirmedAt: '2026-09-21T01:00:00Z' }]
      : [],
    pairA: null,
    pairB: null,
    court: null,
    version: 0,
  }
}

function won(owner: TeamFixture, first: 'a' | 'b', second: 'a' | 'b' = first): FixtureMatch[] {
  return [match(owner, 1, first), match(owner, 2, second)]
}

const f12 = fixture('qualifying', 't1', 't2')
const f13 = fixture('qualifying', 't1', 't3')
const f14 = fixture('qualifying', 't1', 't4')
const f23 = fixture('qualifying', 't2', 't3')
const f24 = fixture('qualifying', 't2', 't4')
const f34 = fixture('qualifying', 't3', 't4')
const qualifying = [f12, f13, f14, f23, f24, f34]
const third = fixture('third-place', 't3', 't4')
const final = fixture('final', 't1', 't2')

/** t1 six wins, t2 four, t3 two, t4 none. */
const separated = [
  ...won(f12, 'a'),
  ...won(f13, 'a'),
  ...won(f14, 'a'),
  ...won(f23, 'a'),
  ...won(f24, 'a'),
  ...won(f34, 'a'),
]

/** t1 six wins; t2, t3 and t4 two each, beating one another in a cycle. */
const threeWayTie = [
  ...won(f12, 'a'),
  ...won(f13, 'a'),
  ...won(f14, 'a'),
  ...won(f23, 'a'),
  ...won(f34, 'a'),
  ...won(f24, 'b'),
]

function round(
  roundNumber: number,
  teamIds: string[],
  fixedFinalistIds: string[],
  availablePlaces: 1 | 2,
  fixtures: TeamFixture[],
): PlayoffRound {
  return {
    id: `round-${roundNumber}`,
    roundNumber,
    teamIds,
    fixedFinalistIds,
    availablePlaces,
    fixtureIds: fixtures.map(({ id }) => id),
  }
}

function state(
  matches: FixtureMatch[],
  fixtures: TeamFixture[] = [...qualifying, third, final],
  overrides: Partial<Tournament> = {},
  playoffRounds: PlayoffRound[] = [],
): ProgressionState {
  return { tournament: { ...tournament, ...overrides }, teams, fixtures, matches, playoffRounds }
}

/** Round 1 of the three-way tie for the last place, and its three fixtures. */
const p23 = fixture('qualification-playoff', 't2', 't3')
const p24 = fixture('qualification-playoff', 't2', 't4')
const p34 = fixture('qualification-playoff', 't3', 't4')
const firstRound = round(1, ['t2', 't3', 't4'], ['t1'], 1, [p23, p24, p34])

/** Each team wins once by the same margin, so round 1 separates nobody. */
const cycle = [
  match(p23, 1, 'a', 'completed', { a: 11, b: 9 }),
  match(p34, 1, 'a', 'completed', { a: 11, b: 9 }),
  match(p24, 1, 'b', 'completed', { a: 9, b: 11 }),
]

/** Round 2 replays the tie; its results alone decide it. */
const q23 = fixture('qualification-playoff', 't2', 't3', '-r2')
const q24 = fixture('qualification-playoff', 't2', 't4', '-r2')
const q34 = fixture('qualification-playoff', 't3', 't4', '-r2')
const secondRound = round(2, ['t2', 't3', 't4'], ['t1'], 1, [q23, q24, q34])

describe('placementParticipants', () => {
  it('sends the top two to the final and the rest to third place, provisional until confirmed', () => {
    expect(placementParticipants(state(separated))).toEqual({
      finalTeamIds: ['t1', 't2'],
      thirdPlaceTeamIds: ['t3', 't4'],
      confirmed: false,
    })
    expect(
      placementParticipants(state(separated, undefined, { finalistsConfirmedAt: '2026-09-21T02:00:00Z' })),
    ).toMatchObject({ confirmed: true })
  })

  it('waits for every qualifying match', () => {
    expect(placementParticipants(state(separated.slice(0, 11)))).toBeNull()
  })

  it('sends two teams tied for both places straight to the final', () => {
    // t1 and t2 draw each other and sweep t3 and t4 with equal margins.
    const matches = [
      ...won(f12, 'a', 'b'),
      ...won(f13, 'a'),
      ...won(f14, 'a'),
      ...won(f23, 'a'),
      ...won(f24, 'a'),
      ...won(f34, 'a'),
    ]

    expect(placementParticipants(state(matches))).toMatchObject({
      finalTeamIds: ['t1', 't2'],
      thirdPlaceTeamIds: ['t3', 't4'],
    })
  })

  it('takes the last place from a completed two-team playoff', () => {
    // t2 and t3 finish level on every criterion behind t1.
    const matches = [
      ...won(f12, 'a'),
      ...won(f13, 'a'),
      ...won(f14, 'a'),
      ...won(f23, 'a', 'b'),
      ...won(f24, 'a'),
      ...won(f34, 'a'),
    ]
    const playoff = fixture('qualification-playoff', 't2', 't3')
    const fixtures = [...qualifying, playoff, third, final]
    const rounds = [round(1, ['t2', 't3'], ['t1'], 1, [playoff])]

    expect(placementParticipants(state(matches, fixtures, {}, rounds))).toBeNull()
    expect(
      placementParticipants(state([...matches, match(playoff, 1, 'b')], fixtures, {}, rounds)),
    ).toMatchObject({ finalTeamIds: ['t1', 't3'], thirdPlaceTeamIds: ['t2', 't4'] })
  })

  it('waits while a stored round does not match the current results', () => {
    const playoff = fixture('qualification-playoff', 't2', 't3')
    const stale = [round(1, ['t2', 't4'], ['t1'], 1, [playoff])]

    expect(
      placementParticipants(state([...threeWayTie, match(playoff, 1, 'a')], [...qualifying, playoff, third, final], {}, stale)),
    ).toBeNull()
  })

  it('plays on when a three-team round stays tied, ranking only the new round', () => {
    const fixtures = [...qualifying, p23, p24, p34, q23, q24, q34, third, final]
    const matches = [...threeWayTie, ...cycle]

    expect(placementParticipants(state(matches, fixtures, {}, [firstRound]))).toBeNull()
    expect(placementParticipants(state(matches, fixtures, {}, [firstRound, secondRound]))).toBeNull()

    // t4 sweeps round 2; round 1 had it level with the others.
    const replay = [
      match(q23, 1, 'a', 'completed', { a: 11, b: 9 }),
      match(q24, 1, 'b', 'completed', { a: 3, b: 11 }),
      match(q34, 1, 'b', 'completed', { a: 3, b: 11 }),
    ]
    expect(
      placementParticipants(state([...matches, ...replay], fixtures, {}, [firstRound, secondRound])),
    ).toMatchObject({ finalTeamIds: ['t1', 't4'], thirdPlaceTeamIds: ['t2', 't3'] })
  })

  it('advances the three-team playoff leader', () => {
    const fixtures = [...qualifying, p23, p24, p34, third, final]
    const matches = [
      ...threeWayTie,
      match(p23, 1, 'b', 'completed', { a: 5, b: 11 }),
      match(p34, 1, 'a', 'completed', { a: 11, b: 5 }),
      match(p24, 1, 'a', 'completed', { a: 11, b: 5 }),
    ]

    expect(placementParticipants(state(matches, fixtures, {}, [firstRound]))).toMatchObject({
      finalTeamIds: ['t1', 't3'],
    })
  })
})

describe('resolvedFinalists', () => {
  it('reports qualifying complete only once all twelve matches finish', () => {
    expect(isQualifyingComplete(state(separated.slice(0, 11)))).toBe(false)
    expect(isQualifyingComplete(state(separated))).toBe(true)
  })

  it('credits finalists to the standings or a playoff', () => {
    expect(resolvedFinalists(state(separated))).toEqual([
      { teamId: 't1', basis: 'standings' },
      { teamId: 't2', basis: 'standings' },
    ])

    const fixtures = [...qualifying, p23, p24, p34, third, final]
    const decisive = [
      match(p23, 1, 'b', 'completed', { a: 5, b: 11 }),
      match(p34, 1, 'a', 'completed', { a: 11, b: 5 }),
      match(p24, 1, 'a', 'completed', { a: 11, b: 5 }),
    ]
    expect(resolvedFinalists(state([...threeWayTie, ...decisive], fixtures, {}, [firstRound]))).toEqual([
      { teamId: 't1', basis: 'standings' },
      { teamId: 't3', basis: 'playoff' },
    ])
  })
})

describe('finalPositions', () => {
  it('requires outcomes for both placement fixtures before completion', () => {
    const withThirdPlace = [...separated, ...won(third, 'a')]
    const complete = [...withThirdPlace, ...won(final, 'b')]
    const fixtures = [...qualifying, third, final]

    expect(finalPositions(fixtures, withThirdPlace)).toBeNull()
    expect(isTournamentComplete(fixtures, withThirdPlace)).toBe(false)
    expect(finalPositions(fixtures, complete)).toEqual(['t2', 't1', 't3', 't4'])
    expect(isTournamentComplete(fixtures, complete)).toBe(true)
  })
})

describe('correctionBlockCode', () => {
  it('blocks any correction once the tournament is complete', () => {
    const complete = [...separated, ...won(third, 'a'), ...won(final, 'a')]

    expect(correctionBlockCode(state(complete), complete)).toBe('tournament-completed')
  })

  it('blocks a qualifying correction that changes a started playoff', () => {
    const playoffTie = [
      ...won(f12, 'a'),
      ...won(f13, 'a'),
      ...won(f14, 'a'),
      ...won(f23, 'a', 'b'),
      ...won(f24, 'a'),
      ...won(f34, 'a'),
    ]
    const playoff = fixture('qualification-playoff', 't2', 't3')
    const fixtures = [...qualifying, playoff, third, final]
    const rounds = [round(1, ['t2', 't3'], ['t1'], 1, [playoff])]
    const playing = match(playoff, 1, null, 'playing')
    const resolved = [...playoffTie.filter(({ fixtureId }) => fixtureId !== f23.id), ...won(f23, 'a')]

    expect(
      correctionBlockCode(state([...playoffTie, playing], fixtures, {}, rounds), [...resolved, playing]),
    ).toBe('playoff-started')
  })

  it('blocks a playoff correction that changes a started continuation round', () => {
    const fixtures = [...qualifying, p23, p24, p34, q23, q24, q34, third, final]
    const current = [...threeWayTie, ...cycle, match(q23, 1, null, 'playing')]
    // t2 now beats t4 in round 1, winning it outright and ending the replay.
    const proposed = [
      ...threeWayTie,
      ...cycle.filter(({ fixtureId }) => fixtureId !== p24.id),
      match(p24, 1, 'a', 'completed', { a: 11, b: 9 }),
      match(q23, 1, null, 'playing'),
    ]
    const rounds = [firstRound, secondRound]

    expect(correctionBlockCode(state(current, fixtures, {}, rounds), proposed)).toBe('playoff-started')

    // Before round 2 starts, the same correction only rebuilds it.
    const unstarted = [...threeWayTie, ...cycle]
    const unstartedProposal = proposed.filter(({ fixtureId }) => fixtureId !== q23.id)
    expect(correctionBlockCode(state(unstarted, fixtures, {}, rounds), unstartedProposal)).toBeNull()
  })

  it('blocks changed placement participants after a placement match starts', () => {
    const current = [...separated, match(third, 1, null, 'playing')]
    const proposed = [
      ...separated.filter(({ fixtureId }) => fixtureId !== f12.id),
      ...won(f12, 'b'),
      match(third, 1, null, 'playing'),
    ]

    // t2 would overtake t1, but both still reach the final.
    expect(correctionBlockCode(state(current), proposed)).toBeNull()

    const demoted = [
      ...separated.filter(({ fixtureId }) => fixtureId !== f23.id && fixtureId !== f24.id),
      ...won(f23, 'b'),
      ...won(f24, 'b'),
      match(third, 1, null, 'playing'),
    ]
    expect(correctionBlockCode(state(current), demoted)).toBe('placement-started')
  })

  it('allows a participant-changing correction before placement play starts', () => {
    const proposed = [
      ...separated.filter(({ fixtureId }) => fixtureId !== f23.id && fixtureId !== f24.id),
      ...won(f23, 'b'),
      ...won(f24, 'b'),
    ]

    expect(correctionBlockCode(state(separated), proposed)).toBeNull()
  })
})
