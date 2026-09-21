import { describe, expect, it } from 'vitest'

import {
  qualifyingStandings,
  requiredPlayoff,
  threeTeamPlayoffOutcome,
} from './standings'
import type {
  FixtureMatch,
  FixtureStage,
  Score,
  Team,
  TeamFixture,
  TeamStanding,
} from './types'

const teams: Team[] = [
  { id: 't1', name: 'Delta' },
  { id: 't2', name: 'Alpha' },
  { id: 't3', name: 'Charlie' },
  { id: 't4', name: 'Bravo' },
]

function fixture(teamAId: string, teamBId: string, stage: FixtureStage = 'qualifying'): TeamFixture {
  return { id: `${stage}-${teamAId}-${teamBId}`, stage, teamAId, teamBId, version: 1 }
}

function played(
  owner: TeamFixture,
  matchNumber: 1 | 2,
  score: Score,
): FixtureMatch {
  return {
    id: `${owner.id}-${matchNumber}`,
    fixtureId: owner.id,
    matchNumber,
    pairA: null,
    pairB: null,
    court: null,
    state: 'completed',
    resultKind: 'played',
    winnerSide: score.a > score.b ? 'a' : 'b',
    games: [{ gameNumber: 1, score, confirmedAt: '2026-09-21T01:00:00Z' }],
    version: 1,
  }
}

/** Both matches of a fixture, each a single game with the given scores. */
function results(owner: TeamFixture, first: Score, second: Score): FixtureMatch[] {
  return [played(owner, 1, first), played(owner, 2, second)]
}

function standing(teamId: string, rank: number): TeamStanding {
  return {
    teamId,
    matchWins: 0,
    pointsScored: 0,
    pointsConceded: 0,
    pointDifference: 0,
    rank,
    separatedBy: null,
  }
}

const f12 = fixture('t1', 't2')
const f13 = fixture('t1', 't3')
const f14 = fixture('t1', 't4')
const f23 = fixture('t2', 't3')
const f24 = fixture('t2', 't4')
const f34 = fixture('t3', 't4')
const qualifying = [f12, f13, f14, f23, f24, f34]

const win = { a: 21, b: 10 }
const loss = { a: 10, b: 21 }

describe('qualifyingStandings', () => {
  it('ranks by total match wins and totals points from played games', () => {
    const matches = [
      ...results(f12, win, win),
      ...results(f13, win, win),
      ...results(f14, win, win),
      ...results(f23, win, win),
      ...results(f24, win, win),
      ...results(f34, win, win),
    ]

    expect(qualifyingStandings(qualifying, matches, teams)).toEqual([
      { teamId: 't1', matchWins: 6, pointsScored: 126, pointsConceded: 60, pointDifference: 66, rank: 1, separatedBy: 'match-wins' },
      { teamId: 't2', matchWins: 4, pointsScored: 104, pointsConceded: 82, pointDifference: 22, rank: 2, separatedBy: 'match-wins' },
      { teamId: 't3', matchWins: 2, pointsScored: 82, pointsConceded: 104, pointDifference: -22, rank: 3, separatedBy: 'match-wins' },
      { teamId: 't4', matchWins: 0, pointsScored: 60, pointsConceded: 126, pointDifference: -66, rank: 4, separatedBy: 'match-wins' },
    ])
  })

  it('separates teams level on match wins by their matches against each other', () => {
    // t1 and t2 both finish on four wins; t1 won their fixture 2–0.
    const matches = [
      ...results(f12, win, win),
      ...results(f13, loss, loss),
      ...results(f14, win, win),
      ...results(f23, win, win),
      ...results(f24, win, win),
      ...results(f34, win, loss),
    ]

    const standings = qualifyingStandings(qualifying, matches, teams)
    expect(standings.map(({ teamId, matchWins, rank, separatedBy }) => ({ teamId, matchWins, rank, separatedBy })))
      .toEqual([
        { teamId: 't1', matchWins: 4, rank: 1, separatedBy: 'tied-match-wins' },
        { teamId: 't2', matchWins: 4, rank: 2, separatedBy: 'tied-match-wins' },
        { teamId: 't3', matchWins: 3, rank: 3, separatedBy: 'match-wins' },
        { teamId: 't4', matchWins: 1, rank: 4, separatedBy: 'match-wins' },
      ])
  })

  it('falls back to point difference among the tied teams after a drawn fixture', () => {
    const matches = [
      ...results(f12, { a: 21, b: 5 }, { a: 19, b: 21 }),
      ...results(f13, win, win),
      ...results(f14, win, win),
      ...results(f23, win, win),
      ...results(f24, win, win),
      ...results(f34, win, loss),
    ]

    const [first, second] = qualifyingStandings(qualifying, matches, teams)
    expect(first).toMatchObject({ teamId: 't1', matchWins: 5, rank: 1, separatedBy: 'tied-point-difference' })
    expect(second).toMatchObject({ teamId: 't2', matchWins: 5, rank: 2, separatedBy: 'tied-point-difference' })
  })

  it('applies the criteria once over the original tied set, never restarting on a subset', () => {
    // t1, t2, t3 each win two matches among themselves and both against t4.
    // Within that set t2 and t3 finish level on wins and point difference, so
    // overall point difference ranks t3 first. Restarting on {t2, t3} would
    // instead rank t2 first, because t2 beat t3 in both matches.
    const matches = [
      ...results(f12, { a: 21, b: 19 }, { a: 21, b: 19 }),
      ...results(f23, { a: 21, b: 16 }, { a: 21, b: 16 }),
      ...results(f13, { a: 13, b: 21 }, { a: 13, b: 21 }),
      ...results(f14, { a: 21, b: 19 }, { a: 21, b: 19 }),
      ...results(f24, { a: 21, b: 19 }, { a: 21, b: 19 }),
      ...results(f34, { a: 21, b: 10 }, { a: 21, b: 10 }),
    ]

    const standings = qualifyingStandings(qualifying, matches, teams)
    expect(standings.map(({ teamId, rank, separatedBy }) => ({ teamId, rank, separatedBy }))).toEqual([
      { teamId: 't3', rank: 1, separatedBy: 'point-difference' },
      { teamId: 't2', rank: 2, separatedBy: 'point-difference' },
      { teamId: 't1', rank: 3, separatedBy: 'tied-point-difference' },
      { teamId: 't4', rank: 4, separatedBy: 'match-wins' },
    ])
  })

  it('gives teams the criteria cannot separate one rank, a marker, and name order', () => {
    const standings = qualifyingStandings(qualifying, [], teams)

    expect(standings.map(({ teamId, rank, separatedBy }) => ({ teamId, rank, separatedBy }))).toEqual([
      { teamId: 't2', rank: 1, separatedBy: null },
      { teamId: 't4', rank: 1, separatedBy: null },
      { teamId: 't3', rank: 1, separatedBy: null },
      { teamId: 't1', rank: 1, separatedBy: null },
    ])
  })

  it('counts a walkover as a match win with no points scored or conceded', () => {
    const walkover: FixtureMatch = {
      ...played(f12, 1, win),
      resultKind: 'walkover',
      games: [],
    }

    const standings = qualifyingStandings(qualifying, [walkover, played(f12, 2, loss)], teams)
    expect(standings.find(({ teamId }) => teamId === 't1')).toMatchObject({
      matchWins: 1,
      pointsScored: 10,
      pointsConceded: 21,
    })
  })

  it('ignores unfinished matches, unconfirmed games, and non-qualifying fixtures', () => {
    const playoff = fixture('t1', 't2', 'qualification-playoff')
    const matches: FixtureMatch[] = [
      { ...played(f12, 1, win), state: 'playing', winnerSide: null },
      { ...played(playoff, 1, win) },
    ]

    expect(qualifyingStandings([...qualifying, playoff], matches, teams).every(
      ({ matchWins, pointsScored }) => matchWins === 0 && pointsScored === 0,
    )).toBe(true)
  })
})

describe('requiredPlayoff', () => {
  it('needs no playoff when the top two are separated or share both places', () => {
    expect(requiredPlayoff([standing('t1', 1), standing('t2', 2), standing('t3', 3), standing('t4', 4)])).toBeNull()
    expect(requiredPlayoff([standing('t1', 1), standing('t2', 1), standing('t3', 3), standing('t4', 4)])).toBeNull()
  })

  it('plays a two-team playoff for the last place', () => {
    expect(requiredPlayoff([standing('t1', 1), standing('t3', 2), standing('t2', 2), standing('t4', 4)])).toEqual({
      format: 'two-team',
      fixedFinalistIds: ['t1'],
      tiedTeamIds: ['t2', 't3'],
      availablePlaces: 1,
    })
  })

  it('plays a three-team playoff for one or both places', () => {
    expect(requiredPlayoff([standing('t1', 1), standing('t2', 2), standing('t3', 2), standing('t4', 2)])).toEqual({
      format: 'three-team',
      fixedFinalistIds: ['t1'],
      tiedTeamIds: ['t2', 't3', 't4'],
      availablePlaces: 1,
    })
    expect(requiredPlayoff([standing('t1', 1), standing('t2', 1), standing('t3', 1), standing('t4', 4)])).toEqual({
      format: 'three-team',
      fixedFinalistIds: [],
      tiedTeamIds: ['t1', 't2', 't3'],
      availablePlaces: 2,
    })
  })

  it('plays a four-team playoff when every team is tied', () => {
    expect(requiredPlayoff(teams.map(({ id }) => standing(id, 1)))).toEqual({
      format: 'four-team',
      fixedFinalistIds: [],
      tiedTeamIds: ['t1', 't2', 't3', 't4'],
      availablePlaces: 2,
    })
  })
})

describe('threeTeamPlayoffOutcome', () => {
  const p12 = fixture('t1', 't2', 'qualification-playoff')
  const p13 = fixture('t1', 't3', 'qualification-playoff')
  const p23 = fixture('t2', 't3', 'qualification-playoff')
  const playoffs = [p12, p13, p23]

  it('advances teams the playoff ranking separates', () => {
    const matches = [
      played(p12, 1, { a: 11, b: 5 }),
      played(p13, 1, { a: 11, b: 9 }),
      played(p23, 1, { a: 11, b: 3 }),
    ]

    expect(threeTeamPlayoffOutcome(playoffs, matches, ['t1', 't2', 't3'], 1)).toEqual({
      automaticTeamIds: ['t1'],
      drawCandidateIds: [],
      drawSlots: 0,
    })
  })

  it('leaves a tie the playoff ranking cannot break to a supervised draw', () => {
    const matches = [
      played(p12, 1, { a: 11, b: 9 }),
      played(p13, 1, { a: 9, b: 11 }),
      played(p23, 1, { a: 11, b: 9 }),
    ]

    expect(threeTeamPlayoffOutcome(playoffs, matches, ['t1', 't2', 't3'], 2)).toEqual({
      automaticTeamIds: [],
      drawCandidateIds: ['t1', 't2', 't3'],
      drawSlots: 2,
    })
  })
})
