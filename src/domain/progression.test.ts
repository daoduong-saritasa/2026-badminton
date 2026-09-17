import { describe, expect, it } from 'vitest'

import {
  correctionBlockCode,
  finalPositions,
  isTournamentComplete,
  placementParticipants,
} from './progression'
import type { FixtureMatch, FixtureStage, Group, TeamFixture } from './types'

const fixtures: TeamFixture[] = [
  fixture('group-a', 'group', 'A', 'a1', 'a2'),
  fixture('group-b', 'group', 'B', 'b1', 'b2'),
  fixture('third', 'third-place', null, 'a2', 'b2'),
  fixture('final', 'final', null, 'a1', 'b1'),
]

function fixture(
  id: string,
  stage: FixtureStage,
  group: Group | null,
  teamAId: string,
  teamBId: string,
): TeamFixture {
  return { id, stage, group, teamAId, teamBId, version: 1 }
}

function match(
  fixtureId: string,
  matchNumber: 1 | 2 | 3,
  winnerSide: 'a' | 'b' | null,
  state: FixtureMatch['state'] = winnerSide ? 'completed' : 'unstarted',
): FixtureMatch {
  return {
    id: `${fixtureId}-${matchNumber}`,
    fixtureId,
    matchNumber,
    state,
    resultKind: winnerSide ? 'played' : null,
    winnerSide,
    games: [],
    pairA: null,
    pairB: null,
    court: null,
    version: 0,
  }
}

function wonFixture(fixtureId: string, winnerSide: 'a' | 'b'): FixtureMatch[] {
  return [match(fixtureId, 1, winnerSide), match(fixtureId, 2, winnerSide)]
}

describe('tournament progression', () => {
  it('sends group winners to the final and losers to third place', () => {
    expect(
      placementParticipants(fixtures, [
        ...wonFixture('group-a', 'a'),
        ...wonFixture('group-b', 'b'),
      ]),
    ).toEqual({
      finalTeamIds: ['a1', 'b2'],
      thirdPlaceTeamIds: ['a2', 'b1'],
    })
  })

  it('requires outcomes for both placement fixtures before completion', () => {
    const groupMatches = [
      ...wonFixture('group-a', 'a'),
      ...wonFixture('group-b', 'a'),
    ]
    const withThirdPlace = [...groupMatches, ...wonFixture('third', 'a')]
    const complete = [...withThirdPlace, ...wonFixture('final', 'b')]

    expect(finalPositions(fixtures, withThirdPlace)).toBeNull()
    expect(isTournamentComplete(fixtures, withThirdPlace)).toBe(false)
    expect(finalPositions(fixtures, complete)).toEqual(['b1', 'a1', 'a2', 'b2'])
    expect(isTournamentComplete(fixtures, complete)).toBe(true)
  })

  it('blocks a correction that invalidates a started decider', () => {
    const current = [
      match('group-a', 1, 'a'),
      match('group-a', 2, 'b'),
      match('group-a', 3, null, 'playing'),
    ]
    const proposed = [
      match('group-a', 1, 'a'),
      match('group-a', 2, 'a'),
      match('group-a', 3, null, 'playing'),
    ]

    expect(correctionBlockCode(fixtures, current, proposed)).toBe('decider-started')
  })

  it('blocks changed advancement after a placement match starts', () => {
    const current = [
      ...wonFixture('group-a', 'a'),
      ...wonFixture('group-b', 'a'),
      match('third', 1, null, 'playing'),
    ]
    const proposed = [
      ...wonFixture('group-a', 'b'),
      ...wonFixture('group-b', 'a'),
      match('third', 1, null, 'playing'),
    ]

    expect(correctionBlockCode(fixtures, current, proposed)).toBe('placement-started')
  })

  it('allows an advancement correction before placement play starts', () => {
    const current = [
      ...wonFixture('group-a', 'a'),
      ...wonFixture('group-b', 'a'),
    ]
    const proposed = [
      ...wonFixture('group-a', 'b'),
      ...wonFixture('group-b', 'a'),
    ]

    expect(correctionBlockCode(fixtures, current, proposed)).toBeNull()
  })
})
