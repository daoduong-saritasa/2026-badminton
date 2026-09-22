import { fixtureWinnerTeamId } from './team-fixtures'
import type { FixtureMatch, TeamFixture, UUID } from './types'

export interface PlayoffRound {
  id: UUID
  roundNumber: number
  teamIds: UUID[]
  fixedFinalistIds: UUID[]
  availablePlaces: 1 | 2
  fixtureIds: UUID[]
}

export interface PlayoffRoundOutcome {
  finalistIds: UUID[]
  nextRound: {
    teamIds: UUID[]
    fixedFinalistIds: UUID[]
    availablePlaces: 1 | 2
  } | null
}

interface PlayoffResult {
  teamAId: UUID
  teamBId: UUID
  winnerTeamId: UUID
  pointsA: number
  pointsB: number
}

interface RankedTeam {
  teamId: UUID
  wins: number
  pointDifference: number
  pointsScored: number
}

export function resolvePlayoffRound(
  round: PlayoffRound,
  fixtures: readonly TeamFixture[],
  matches: readonly FixtureMatch[],
): PlayoffRoundOutcome | null {
  const roundFixtureIds = new Set(round.fixtureIds)
  const roundFixtures = fixtures.filter((fixture) => roundFixtureIds.has(fixture.id))
  if (roundFixtures.length !== round.fixtureIds.length || roundFixtures.length === 0) return null

  const winners = roundFixtures.map((fixture) => fixtureWinnerTeamId(fixture, matches))
  if (winners.some((winner) => winner === null)) return null

  if (round.teamIds.length === 2 || round.teamIds.length === 4) {
    return {
      finalistIds: sortedUnique([
        ...round.fixedFinalistIds,
        ...winners.filter((winner) => winner !== null),
      ]),
      nextRound: null,
    }
  }

  if (round.teamIds.length !== 3) return null
  const results = roundFixtures.flatMap((fixture) => resultFor(fixture, matches))
  if (results.length !== roundFixtures.length) return null

  const ranked = round.teamIds.map((teamId) => rankTeam(teamId, results))
  const ordered = [...ranked].sort(compareRankedTeams)
  const cutoff = ordered[round.availablePlaces - 1]
  if (!cutoff) return null

  const automatic = ordered.filter((team) => comparePerformance(team, cutoff) < 0)
  const candidates = ordered.filter((team) => sameRank(team, cutoff))
  const remainingPlaces = round.availablePlaces - automatic.length
  const fixedFinalistIds = sortedUnique([
    ...round.fixedFinalistIds,
    ...automatic.map((team) => team.teamId),
  ])

  if (candidates.length > remainingPlaces) {
    return {
      finalistIds: fixedFinalistIds,
      nextRound: {
        teamIds: candidates.map((team) => team.teamId).sort(),
        fixedFinalistIds,
        availablePlaces: remainingPlaces as 1 | 2,
      },
    }
  }

  return {
    finalistIds: sortedUnique([
      ...fixedFinalistIds,
      ...candidates.map((team) => team.teamId),
    ]),
    nextRound: null,
  }
}

function resultFor(
  fixture: TeamFixture,
  matches: readonly FixtureMatch[],
): PlayoffResult[] {
  if (!fixture.teamAId || !fixture.teamBId) return []
  const match = matches.find((candidate) => candidate.fixtureId === fixture.id)
  if (!match || match.state !== 'completed' || match.winnerSide === null) return []

  const played = match.resultKind === 'played'
  const confirmedGames = match.games.filter((game) => game.confirmedAt !== null)
  return [{
    teamAId: fixture.teamAId,
    teamBId: fixture.teamBId,
    winnerTeamId: match.winnerSide === 'a' ? fixture.teamAId : fixture.teamBId,
    pointsA: played ? sum(confirmedGames.map((game) => game.score.a)) : 0,
    pointsB: played ? sum(confirmedGames.map((game) => game.score.b)) : 0,
  }]
}

function rankTeam(teamId: UUID, results: readonly PlayoffResult[]): RankedTeam {
  const own = results.filter((result) => result.teamAId === teamId || result.teamBId === teamId)
  const pointsScored = sum(own.map((result) =>
    result.teamAId === teamId ? result.pointsA : result.pointsB))
  const pointsConceded = sum(own.map((result) =>
    result.teamAId === teamId ? result.pointsB : result.pointsA))
  return {
    teamId,
    wins: own.filter((result) => result.winnerTeamId === teamId).length,
    pointDifference: pointsScored - pointsConceded,
    pointsScored,
  }
}

/** Negative when left ranks above right. Team IDs stabilize display only. */
function compareRankedTeams(left: RankedTeam, right: RankedTeam): number {
  return comparePerformance(left, right) || left.teamId.localeCompare(right.teamId)
}

function comparePerformance(left: RankedTeam, right: RankedTeam): number {
  return right.wins - left.wins ||
    right.pointDifference - left.pointDifference ||
    right.pointsScored - left.pointsScored
}

function sameRank(left: RankedTeam, right: RankedTeam): boolean {
  return left.wins === right.wins &&
    left.pointDifference === right.pointDifference &&
    left.pointsScored === right.pointsScored
}

function sortedUnique(ids: readonly UUID[]): UUID[] {
  return [...new Set(ids)].sort()
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
