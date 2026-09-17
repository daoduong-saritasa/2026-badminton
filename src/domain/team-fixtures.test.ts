import { describe, expect, it } from 'vitest'

import {
  deciderStatus,
  fixtureTally,
  fixtureWinnerTeamId,
} from './team-fixtures'
import type { FixtureMatch, TeamFixture } from './types'

const fixture: TeamFixture = {
  id: 'fixture-a',
  stage: 'group',
  group: 'A',
  teamAId: 'team-a',
  teamBId: 'team-b',
  version: 1,
}

function match(
  matchNumber: 1 | 2 | 3,
  winnerSide: 'a' | 'b' | null,
  resultKind: 'played' | 'walkover' | null = winnerSide ? 'played' : null,
): FixtureMatch {
  return {
    id: `match-${matchNumber}`,
    fixtureId: fixture.id,
    matchNumber,
    state: winnerSide ? 'completed' : 'unstarted',
    resultKind,
    winnerSide,
    games: [],
    pairA: null,
    pairB: null,
    court: null,
    version: 0,
  }
}

describe('team fixture rules', () => {
  it('counts played and walkover wins toward the fixture tally', () => {
    expect(
      fixtureTally([match(1, 'a'), match(2, 'b', 'walkover'), match(3, null)]),
    ).toEqual({ a: 1, b: 1 })
  })

  it('enables the decider only after both openers resolve at 1–1', () => {
    expect(deciderStatus([match(1, 'a'), match(2, null)])).toBe('pending')
    expect(deciderStatus([match(1, 'a'), match(2, 'b')])).toBe('eligible')
    expect(deciderStatus([match(1, 'a'), match(2, 'a')])).toBe('unnecessary')
  })

  it('returns the first team to two wins', () => {
    expect(
      fixtureWinnerTeamId(fixture, [
        match(1, 'a'),
        match(2, 'b', 'walkover'),
        match(3, 'a'),
      ]),
    ).toBe('team-a')
  })

  it('does not choose a winner while a required match is unresolved', () => {
    expect(
      fixtureWinnerTeamId(fixture, [match(1, 'a'), match(2, 'b'), match(3, null)]),
    ).toBeNull()
  })
})
