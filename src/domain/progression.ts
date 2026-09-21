import {
  qualificationCutoff,
  qualifyingStandings,
  threeTeamPlayoffOutcome,
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
  'tournament' | 'teams' | 'fixtures' | 'matches'
>

export interface PlacementParticipants {
  finalTeamIds: [UUID, UUID]
  thirdPlaceTeamIds: [UUID, UUID]
  /** Qualification stays provisional until the organizer confirms it. */
  confirmed: boolean
}

export type CorrectionBlockCode =
  | 'playoff-started'
  | 'placement-started'
  | 'tournament-completed'

/** Six qualifying fixtures of two matches each. */
const qualifyingMatchCount = 12

/**
 * Who plays the final and the third-place fixture, derived from the finished
 * qualifying standings and any qualification playoff or supervised draw.
 * Null while qualifying, a required playoff, or a required draw is
 * unresolved. Mirrors `private.populate_placement_fixtures()`; each pair is in
 * team id order, as the server assigns them.
 */
export function placementParticipants(
  state: ProgressionState,
): PlacementParticipants | null {
  const finalistIds = resolvedFinalistIds(state)
  if (!finalistIds) {
    return null
  }

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

  if (
    stageStarted(state, (stage) => stage === 'qualification-playoff') &&
    !sameCutoff(cutoffFor(state), cutoffFor(proposed))
  ) {
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

function resolvedFinalistIds(state: ProgressionState): UUID[] | null {
  if (!qualifyingFinished(state)) {
    return null
  }

  const cutoff = cutoffFor(state)
  if (!cutoff) {
    return null
  }
  if (cutoff.tiedTeamIds.length <= cutoff.availablePlaces) {
    return [...cutoff.fixedFinalistIds, ...cutoff.tiedTeamIds]
  }

  const playoffs = state.fixtures.filter(
    (fixture) => fixture.stage === 'qualification-playoff',
  )
  const winners = playoffs.map((fixture) => fixtureWinnerTeamId(fixture, state.matches))
  if (playoffs.length === 0 || winners.some((winner) => winner === null)) {
    return null
  }

  if (cutoff.tiedTeamIds.length !== 3) {
    return [...cutoff.fixedFinalistIds, ...winners.filter((id) => id !== null)]
  }

  const outcome = threeTeamPlayoffOutcome(
    playoffs,
    state.matches,
    cutoff.tiedTeamIds,
    cutoff.availablePlaces,
  )
  if (!outcome) {
    return null
  }
  if (outcome.drawSlots === 0) {
    return [...cutoff.fixedFinalistIds, ...outcome.automaticTeamIds]
  }

  const drawn = drawnPlayoffTeamIds(
    state.tournament.qualificationDrawWinnerIds,
    outcome.automaticTeamIds,
    outcome.drawCandidateIds,
    cutoff.availablePlaces,
  )
  return drawn ? [...cutoff.fixedFinalistIds, ...drawn] : null
}

/**
 * The stored draw result, or null when it no longer fits the playoff: it must
 * hold every automatic qualifier plus exactly the open places, drawn from the
 * tied candidates.
 */
function drawnPlayoffTeamIds(
  drawWinnerIds: readonly UUID[] | null,
  automaticTeamIds: readonly UUID[],
  candidateIds: readonly UUID[],
  availablePlaces: number,
): UUID[] | null {
  if (!drawWinnerIds || new Set(drawWinnerIds).size !== availablePlaces) {
    return null
  }

  const drawn = drawWinnerIds.filter((teamId) => !automaticTeamIds.includes(teamId))
  const valid =
    automaticTeamIds.every((teamId) => drawWinnerIds.includes(teamId)) &&
    drawn.length === availablePlaces - automaticTeamIds.length &&
    drawn.every((teamId) => candidateIds.includes(teamId))

  return valid ? [...drawWinnerIds] : null
}

function qualifyingFinished(state: ProgressionState): boolean {
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

function sameCutoff(
  left: QualificationCutoff | null,
  right: QualificationCutoff | null,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
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
