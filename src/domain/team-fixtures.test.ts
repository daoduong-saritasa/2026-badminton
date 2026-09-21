import { describe, expect, it } from 'vitest'

import {
  deciderStatus,
  fixtureTally,
  fixtureWinnerTeamId,
} from './team-fixtures'
import type { FixtureMatch, FixtureStage, TeamFixture } from './types'

function fixture(stage: FixtureStage): TeamFixture {
  return {
    id: `fixture-${stage}`,
    stage,
    teamAId: 'team-a',
    teamBId: 'team-b',
    version: 1,
  }
}

const final = fixture('final')

function match(
  matchNumber: 1 | 2 | 3,
  winnerSide: 'a' | 'b' | null,
  resultKind: 'played' | 'walkover' | null = winnerSide ? 'played' : null,
  owner: TeamFixture = final,
): FixtureMatch {
  return {
    id: `match-${owner.stage}-${matchNumber}`,
    fixtureId: owner.id,
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

  it('enables a placement decider only after both openers resolve at 1–1', () => {
    expect(deciderStatus(final, [match(1, 'a'), match(2, null)])).toBe('pending')
    expect(deciderStatus(final, [match(1, 'a'), match(2, 'b')])).toBe('eligible')
    expect(deciderStatus(final, [match(1, 'a'), match(2, 'a')])).toBe('unnecessary')
  })

  it('never enables a decider outside placement fixtures', () => {
    const qualifying = fixture('qualifying')

    expect(
      deciderStatus(qualifying, [
        match(1, 'a', 'played', qualifying),
        match(2, 'b', 'played', qualifying),
      ]),
    ).toBe('unnecessary')
  })

  it('returns the first placement team to two wins', () => {
    expect(
      fixtureWinnerTeamId(final, [
        match(1, 'a'),
        match(2, 'b', 'walkover'),
        match(3, 'a'),
      ]),
    ).toBe('team-a')
  })

  it('does not choose a winner while a required match is unresolved', () => {
    expect(
      fixtureWinnerTeamId(final, [match(1, 'a'), match(2, 'b'), match(3, null)]),
    ).toBeNull()
  })

  it('has no winner for a drawn qualifying fixture and a winner for a sweep', () => {
    const qualifying = fixture('qualifying')

    expect(
      fixtureWinnerTeamId(qualifying, [
        match(1, 'a', 'played', qualifying),
        match(2, 'b', 'played', qualifying),
      ]),
    ).toBeNull()
    expect(
      fixtureWinnerTeamId(qualifying, [
        match(1, 'b', 'played', qualifying),
        match(2, 'b', 'walkover', qualifying),
      ]),
    ).toBe('team-b')
  })

  it('decides a qualification playoff on its single match', () => {
    const playoff = fixture('qualification-playoff')

    expect(fixtureWinnerTeamId(playoff, [match(1, null, null, playoff)])).toBeNull()
    expect(fixtureWinnerTeamId(playoff, [match(1, 'b', 'walkover', playoff)])).toBe('team-b')
  })
})
