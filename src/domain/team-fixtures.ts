import type { FixtureMatch, Score, TeamFixture, UUID } from './types'

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

export function deciderStatus(matches: readonly FixtureMatch[]): DeciderStatus {
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

export function fixtureWinnerTeamId(
  fixture: TeamFixture,
  matches: readonly FixtureMatch[],
): UUID | null {
  const tally = fixtureTally(
    matches.filter((match) => match.fixtureId === fixture.id),
  )

  if (tally.a >= 2) {
    return fixture.teamAId
  }
  if (tally.b >= 2) {
    return fixture.teamBId
  }
  return null
}
