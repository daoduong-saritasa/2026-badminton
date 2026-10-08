import { describe, expect, it } from 'vitest'
import { courtQueue, qualifyingCourtAssignments, qualifyingCourtLocked, qualifyingRound, qualifyingStartBlocker } from './qualifying-schedule'
import type { Court, FixtureMatch, TeamFixture, TournamentSnapshot } from './types'

function schedule(): TournamentSnapshot {
  const fixtures: TeamFixture[] = ['ab', 'cd', 'ac', 'bd', 'ad', 'bc'].map((id, index) => ({
    id, stage: 'qualifying', teamAId: id[0], teamBId: id[1], version: 1,
    qualifyingOrder: index + 1, qualifyingCourt: (index % 2 + 1) as Court,
  }))
  const matches: FixtureMatch[] = fixtures.flatMap((fixture) => ([1, 2] as const).map((matchNumber) => ({
    id: `${fixture.id}${matchNumber}`, fixtureId: fixture.id, matchNumber, court: fixture.qualifyingCourt,
    state: 'unstarted', resultKind: null, winnerSide: null, pairA: null, pairB: null, games: [], version: 1,
  })))
  return {
    tournament: { id: 't', name: 'T', stage: 'groups', setupLockedAt: null, version: 1, resultRevision: 1, courtNames: ['One', 'Two'], finalistsConfirmedAt: null, currentPlayoffRoundId: null },
    fixtures, matches, players: [], teams: [], playoffRounds: [],
  }
}
function complete(snapshot: TournamentSnapshot, count: number) {
  snapshot.matches.slice(0, count).forEach((match) => { match.state = 'completed'; match.resultKind = 'walkover'; match.winnerSide = 'a' })
}

describe('qualifying schedule', () => {
  it('gives all teams one appearance per round and every opponent once', () => {
    const snapshot = schedule()
    for (const round of [1, 2, 3]) {
      const fixtures = snapshot.fixtures.filter((fixture) => qualifyingRound(fixture) === round)
      expect(fixtures.map((fixture) => fixture.qualifyingCourt)).toEqual([1, 2])
      expect(new Set(fixtures.flatMap((fixture) => [fixture.teamAId, fixture.teamBId])).size).toBe(4)
    }
    expect(new Set(snapshot.fixtures.map((fixture) => fixture.id)).size).toBe(6)
  })
  it('requires the first match, including walkovers, before the second', () => {
    const snapshot = schedule()
    expect(qualifyingStartBlocker(snapshot, snapshot.matches[1])).toBe('sequence')
    complete(snapshot, 1)
    expect(qualifyingStartBlocker(snapshot, snapshot.matches[1])).toBeNull()
  })
  it('waits for both courts and every earlier round', () => {
    const snapshot = schedule()
    complete(snapshot, 3)
    expect(qualifyingStartBlocker(snapshot, snapshot.matches[4])).toBe('round')
    complete(snapshot, 4)
    expect(qualifyingStartBlocker(snapshot, snapshot.matches[4])).toBeNull()
    expect(qualifyingStartBlocker(snapshot, snapshot.matches[8])).toBe('round')
    complete(snapshot, 8)
    expect(qualifyingStartBlocker(snapshot, snapshot.matches[8])).toBeNull()
    snapshot.matches[0].state = 'unstarted'
    expect(qualifyingStartBlocker(snapshot, snapshot.matches[8])).toBe('round')
    expect(snapshot.matches[7].state).toBe('completed')
  })
  it('does not treat a missing prerequisite as complete', () => {
    const snapshot = schedule()
    complete(snapshot, 4)
    snapshot.matches = snapshot.matches.filter((match) => match.id !== 'cd2')
    expect(qualifyingStartBlocker(snapshot, snapshot.matches.find((match) => match.id === 'ac1')!)).toBe('round')
  })
  it('swaps both fixtures and all four matches atomically', () => {
    const snapshot = schedule()
    expect(qualifyingCourtAssignments(snapshot, snapshot.matches[0], 2)).toEqual([
      { matchId: 'ab1', court: 2 }, { matchId: 'ab2', court: 2 }, { matchId: 'cd1', court: 1 }, { matchId: 'cd2', court: 1 },
    ])
    snapshot.matches[2].state = 'playing'
    expect(qualifyingCourtLocked(snapshot, snapshot.fixtures[0])).toBe(true)
    expect(qualifyingCourtAssignments(snapshot, snapshot.matches[0], 2)).toEqual([])
  })
  it('locks courts after score records even when state is unstarted', () => {
    const snapshot = schedule()
    snapshot.matches[0].games = [{ gameNumber: 1, score: { a: 0, b: 0 }, confirmedAt: null }]
    expect(qualifyingCourtLocked(snapshot, snapshot.fixtures[0])).toBe(true)
  })
  it('shows each court current and next without promoting a blocked round', () => {
    const snapshot = schedule()
    expect(courtQueue(snapshot, 1).current?.id).toBe('ab1')
    expect(courtQueue(snapshot, 1).next?.id).toBe('ab2')
    complete(snapshot, 2)
    expect(courtQueue(snapshot, 1).current).toBeUndefined()
    expect(courtQueue(snapshot, 1).next?.id).toBe('ac1')
    complete(snapshot, 4)
    expect(courtQueue(snapshot, 1).current?.id).toBe('ac1')
  })
})
