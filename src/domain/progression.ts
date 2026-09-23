import { resolvePlayoffRound, type PlayoffRound } from './playoff-rounds'
import {
  qualificationCutoff,
  qualifyingStandings,
  type QualificationCutoff,
} from './standings'
import { fixtureWinnerTeamId, isPlacementStage } from './team-fixtures'
import type {
  FixtureMatch,
  FixtureStage,
  TeamFixture,
  TournamentSnapshot,
  UUID,
} from './types'

export type ProgressionState = Pick<
  TournamentSnapshot,
  'tournament' | 'teams' | 'fixtures' | 'matches' | 'playoffRounds'
>

export interface PlacementParticipants {
  finalTeamIds: [UUID, UUID]
  thirdPlaceTeamIds: [UUID, UUID]
  /** Qualification stays provisional until the organizer confirms it. */
  confirmed: boolean
}

/** How a finalist earned its place, for the organizer's confirmation. */
export type FinalistBasis = 'standings' | 'playoff'

export interface Finalist {
  teamId: UUID
  basis: FinalistBasis
}

export type CorrectionBlockCode =
  | 'playoff-started'
  | 'placement-started'
  | 'tournament-completed'

/** Six qualifying fixtures of two matches each. */
const qualifyingMatchCount = 12

/**
 * Who plays the final and the third-place fixture, derived from the finished
 * qualifying standings and any qualification playoff rounds. Null while
 * qualifying or a required playoff round is unresolved. Mirrors `private.populate_placement_fixtures()`; each pair is in
 * team id order, as the server assigns them.
 */
export function placementParticipants(
  state: ProgressionState,
): PlacementParticipants | null {
  const finalists = resolvedFinalists(state)
  if (!finalists) {
    return null
  }
  const finalistIds = finalists.map(({ teamId }) => teamId)

  const [first, second] = [...finalistIds].sort()
  const [third, fourth] = state.teams
    .map((team) => team.id)
    .filter((teamId) => !finalistIds.includes(teamId))
    .sort()

  if (!first || !second || !third || !fourth) {
    return null
  }

  return {
    finalTeamIds: [first, second],
    thirdPlaceTeamIds: [third, fourth],
    confirmed: state.tournament.finalistsConfirmedAt !== null,
  }
}

export function finalPositions(
  fixtures: readonly TeamFixture[],
  matches: readonly FixtureMatch[],
): [UUID, UUID, UUID, UUID] | null {
  const final = fixtures.find((fixture) => fixture.stage === 'final')
  const thirdPlace = fixtures.find((fixture) => fixture.stage === 'third-place')

  if (!final || !thirdPlace) {
    return null
  }

  const first = fixtureWinnerTeamId(final, matches)
  const third = fixtureWinnerTeamId(thirdPlace, matches)
  const second = fixtureLoserTeamId(final, first)
  const fourth = fixtureLoserTeamId(thirdPlace, third)

  return first && second && third && fourth
    ? [first, second, third, fourth]
    : null
}

export function isTournamentComplete(
  fixtures: readonly TeamFixture[],
  matches: readonly FixtureMatch[],
): boolean {
  return finalPositions(fixtures, matches) !== null
}

/**
 * Why a proposed correction is blocked, mirroring
 * `private.team_correction_block_code()`. The server's impact preview is
 * authoritative; this lets the client explain a block before asking for one.
 */
export function correctionBlockCode(
  state: ProgressionState,
  proposedMatches: readonly FixtureMatch[],
): CorrectionBlockCode | null {
  if (isTournamentComplete(state.fixtures, state.matches)) {
    return 'tournament-completed'
  }

  const proposed: ProgressionState = { ...state, matches: [...proposedMatches] }

  if (startedRoundChanges(state, proposed)) {
    return 'playoff-started'
  }

  if (
    stageStarted(state, isPlacementStage) &&
    !sameParticipants(placementParticipants(state), placementParticipants(proposed))
  ) {
    return 'placement-started'
  }

  return null
}

/**
 * The two finalists in team id order, each with how it qualified, or null while
 * qualification is unresolved.
 */
export function resolvedFinalists(state: ProgressionState): Finalist[] | null {
  const cutoff = cutoffFor(state)
  const ids = resolvedFinalistIds(state)
  if (!cutoff || !ids) {
    return null
  }

  const byStandings = new Set(
    cutoff.tiedTeamIds.length <= cutoff.availablePlaces
      ? [...cutoff.fixedFinalistIds, ...cutoff.tiedTeamIds]
      : cutoff.fixedFinalistIds,
  )

  return [...ids].sort().map((teamId) => ({
    teamId,
    basis: byStandings.has(teamId) ? 'standings' : 'playoff',
  }))
}

type RoundComposition = Pick<PlayoffRound, 'teamIds' | 'fixedFinalistIds' | 'availablePlaces'>

/**
 * The rounds the current results call for, in order, mirroring the walk in
 * `private.populate_placement_fixtures()`: round 1 comes from the qualifying
 * tie, and each later round from its stored predecessor's outcome. The walk
 * stops at the first round that is missing, differs, or is unresolved.
 */
function expectedRounds(state: ProgressionState): {
  compositions: RoundComposition[]
  finalistIds: UUID[] | null
} {
  const none = { compositions: [], finalistIds: null }
  if (!isQualifyingComplete(state)) {
    return none
  }
  const cutoff = cutoffFor(state)
  if (!cutoff) {
    return none
  }
  if (cutoff.tiedTeamIds.length <= cutoff.availablePlaces) {
    return {
      compositions: [],
      finalistIds: [...cutoff.fixedFinalistIds, ...cutoff.tiedTeamIds],
    }
  }

  const compositions: RoundComposition[] = []
  let expected: RoundComposition = {
    teamIds: cutoff.tiedTeamIds,
    fixedFinalistIds: cutoff.fixedFinalistIds,
    availablePlaces: cutoff.availablePlaces as 1 | 2,
  }
  for (let roundNumber = 1; ; roundNumber += 1) {
    compositions.push(expected)
    const stored = state.playoffRounds.find((round) => round.roundNumber === roundNumber)
    if (!stored || !sameComposition(stored, expected)) {
      return { compositions, finalistIds: null }
    }
    const outcome = resolvePlayoffRound(stored, state.fixtures, state.matches)
    if (!outcome) {
      return { compositions, finalistIds: null }
    }
    if (!outcome.nextRound) {
      return { compositions, finalistIds: outcome.finalistIds }
    }
    expected = outcome.nextRound
  }
}

function resolvedFinalistIds(state: ProgressionState): UUID[] | null {
  return expectedRounds(state).finalistIds
}

/**
 * Whether the proposed results would rebuild a stored round that already has
 * a started match; the server rejects that as `playoff-started`.
 */
function startedRoundChanges(state: ProgressionState, proposed: ProgressionState): boolean {
  const startedFixtureIds = new Set(
    state.matches
      .filter((match) => match.state === 'playing' || match.state === 'completed')
      .map((match) => match.fixtureId),
  )
  const { compositions } = expectedRounds(proposed)
  return state.playoffRounds.some((round) => {
    if (!round.fixtureIds.some((fixtureId) => startedFixtureIds.has(fixtureId))) {
      return false
    }
    const expected = compositions[round.roundNumber - 1]
    return !expected || !sameComposition(round, expected)
  })
}

function sameComposition(left: RoundComposition, right: RoundComposition): boolean {
  return JSON.stringify([
    [...left.teamIds].sort(),
    [...left.fixedFinalistIds].sort(),
    left.availablePlaces,
  ]) === JSON.stringify([
    [...right.teamIds].sort(),
    [...right.fixedFinalistIds].sort(),
    right.availablePlaces,
  ])
}

/** Every qualifying match is completed. Standings before then are provisional. */
export function isQualifyingComplete(state: ProgressionState): boolean {
  const qualifyingMatches = matchesInStage(state, (stage) => stage === 'qualifying')

  return (
    qualifyingMatches.length === qualifyingMatchCount &&
    qualifyingMatches.every(
      (match) => match.state === 'completed' || match.state === 'unnecessary',
    )
  )
}

function cutoffFor(state: ProgressionState): QualificationCutoff | null {
  return qualificationCutoff(
    qualifyingStandings(state.fixtures, state.matches, state.teams),
  )
}

function stageStarted(
  state: ProgressionState,
  inStage: (stage: FixtureStage) => boolean,
): boolean {
  return matchesInStage(state, inStage).some(
    (match) => match.state === 'playing' || match.state === 'completed',
  )
}

function matchesInStage(
  state: ProgressionState,
  inStage: (stage: FixtureStage) => boolean,
): FixtureMatch[] {
  const fixtureIds = new Set(
    state.fixtures.filter((fixture) => inStage(fixture.stage)).map(({ id }) => id),
  )
  return state.matches.filter((match) => fixtureIds.has(match.fixtureId))
}

function sameParticipants(
  left: PlacementParticipants | null,
  right: PlacementParticipants | null,
): boolean {
  return (
    JSON.stringify([left?.finalTeamIds, left?.thirdPlaceTeamIds]) ===
    JSON.stringify([right?.finalTeamIds, right?.thirdPlaceTeamIds])
  )
}

function fixtureLoserTeamId(
  fixture: TeamFixture,
  winnerTeamId: UUID | null,
): UUID | null {
  if (!winnerTeamId) {
    return null
  }
  if (winnerTeamId === fixture.teamAId) {
    return fixture.teamBId
  }
  if (winnerTeamId === fixture.teamBId) {
    return fixture.teamAId
  }
  return null
}
