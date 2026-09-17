import { deciderStatus, fixtureWinnerTeamId } from './team-fixtures'
import type { FixtureMatch, TeamFixture, UUID } from './types'

export interface PlacementParticipants {
  finalTeamIds: [UUID, UUID]
  thirdPlaceTeamIds: [UUID, UUID]
}

export type CorrectionBlockCode =
  | 'decider-started'
  | 'placement-started'
  | 'tournament-completed'

export function placementParticipants(
  groupFixtures: readonly TeamFixture[],
  matches: readonly FixtureMatch[],
): PlacementParticipants | null {
  const groupA = groupFixtures.find(
    (fixture) => fixture.stage === 'group' && fixture.group === 'A',
  )
  const groupB = groupFixtures.find(
    (fixture) => fixture.stage === 'group' && fixture.group === 'B',
  )

  if (!groupA || !groupB) {
    return null
  }
  const winnerA = fixtureWinnerTeamId(groupA, matches)
  const winnerB = fixtureWinnerTeamId(groupB, matches)
  const loserA = fixtureLoserTeamId(groupA, winnerA)
  const loserB = fixtureLoserTeamId(groupB, winnerB)

  if (!winnerA || !winnerB || !loserA || !loserB) {
    return null
  }

  return {
    finalTeamIds: [winnerA, winnerB],
    thirdPlaceTeamIds: [loserA, loserB],
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

export function correctionBlockCode(
  fixtures: readonly TeamFixture[],
  currentMatches: readonly FixtureMatch[],
  proposedMatches: readonly FixtureMatch[],
): CorrectionBlockCode | null {
  if (isTournamentComplete(fixtures, currentMatches)) {
    return 'tournament-completed'
  }

  for (const fixture of fixtures.filter(({ stage }) => stage === 'group')) {
    const currentFixtureMatches = matchesForFixture(fixture.id, currentMatches)
    const proposedFixtureMatches = matchesForFixture(fixture.id, proposedMatches)
    const decider = currentFixtureMatches.find(({ matchNumber }) => matchNumber === 3)

    if (
      decider &&
      hasStarted(decider) &&
      deciderStatus(currentFixtureMatches) === 'eligible' &&
      deciderStatus(proposedFixtureMatches) === 'unnecessary'
    ) {
      return 'decider-started'
    }
  }

  const groupFixtures = fixtures.filter(({ stage }) => stage === 'group')
  const currentParticipants = placementParticipants(groupFixtures, currentMatches)
  const proposedParticipants = placementParticipants(groupFixtures, proposedMatches)
  const advancementChanged =
    JSON.stringify(currentParticipants) !== JSON.stringify(proposedParticipants)
  const placementStarted = fixtures
    .filter(({ stage }) => stage !== 'group')
    .flatMap((fixture) => matchesForFixture(fixture.id, currentMatches))
    .some(hasStarted)

  return advancementChanged && placementStarted ? 'placement-started' : null
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

function matchesForFixture(
  fixtureId: UUID,
  matches: readonly FixtureMatch[],
): FixtureMatch[] {
  return matches.filter((match) => match.fixtureId === fixtureId)
}

function hasStarted(match: FixtureMatch): boolean {
  return match.state === 'playing' || match.state === 'completed'
}
