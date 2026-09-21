import type { FixtureMatch, FixtureStage, Score, TeamFixture, UUID } from './types'

export type DeciderStatus = 'pending' | 'eligible' | 'unnecessary'

export function fixtureTally(matches: readonly FixtureMatch[]): Score {
  return matches.reduce<Score>(
    (tally, match) => {
      if (
        match.state !== 'completed' ||
        match.resultKind === null ||
        match.winnerSide === null
      ) {
        return tally
      }

      return match.winnerSide === 'a'
        ? { ...tally, a: tally.a + 1 }
        : { ...tally, b: tally.b + 1 }
    },
    { a: 0, b: 0 },
  )
}

/**
 * Whether a placement fixture needs match 3. Qualifying and playoff fixtures
 * have no decider, so they always report `'unnecessary'`.
 */
export function deciderStatus(
  fixture: TeamFixture,
  matches: readonly FixtureMatch[],
): DeciderStatus {
  if (!isPlacementStage(fixture.stage)) {
    return 'unnecessary'
  }

  const openers = ([1, 2] as const).map((matchNumber) =>
    matches.find((match) => match.matchNumber === matchNumber),
  )

  if (
    openers.some(
      (match) =>
        !match ||
        match.state !== 'completed' ||
        match.resultKind === null ||
        match.winnerSide === null,
    )
  ) {
    return 'pending'
  }

  const tally = fixtureTally(openers.filter((match) => match !== undefined))
  return tally.a === 1 && tally.b === 1 ? 'eligible' : 'unnecessary'
}

/**
 * The team that won the fixture, or null while undecided. A qualification
 * playoff is one match; any other fixture needs two match wins, so a drawn
 * qualifying fixture (1–1) has no winner.
 */
export function fixtureWinnerTeamId(
  fixture: TeamFixture,
  matches: readonly FixtureMatch[],
): UUID | null {
  const tally = fixtureTally(
    matches.filter((match) => match.fixtureId === fixture.id),
  )
  const needed = fixture.stage === 'qualification-playoff' ? 1 : 2

  if (tally.a >= needed) {
    return fixture.teamAId
  }
  if (tally.b >= needed) {
    return fixture.teamBId
  }
  return null
}

export function isPlacementStage(stage: FixtureStage): boolean {
  return stage === 'third-place' || stage === 'final'
}
