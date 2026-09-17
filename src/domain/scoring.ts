import type { FixtureStage, Game, Score, Side } from './types'

export function gameRules(stage: FixtureStage): { target: number; cap: number } {
  return stage === 'final'
    ? { target: 21, cap: 30 }
    : { target: 15, cap: 21 }
}

export function isGameWon(score: Score, stage: FixtureStage): boolean {
  const { target, cap } = gameRules(stage)
  const { a, b } = score

  if (
    !Number.isInteger(a) ||
    !Number.isInteger(b) ||
    a < 0 ||
    b < 0 ||
    a > cap ||
    b > cap ||
    a === b
  ) {
    return false
  }

  const winner = Math.max(a, b)
  const loser = Math.min(a, b)

  if (winner === cap) {
    return loser === cap - 1 || winner - loser === 2
  }

  if (winner === target) {
    return loser <= target - 2
  }

  return winner > target && winner < cap && winner - loser === 2
}

export function matchGameTally(games: readonly Game[]): Score {
  return games.reduce<Score>(
    (tally, game) => {
      if (game.confirmedAt === null || game.score.a === game.score.b) {
        return tally
      }

      return game.score.a > game.score.b
        ? { ...tally, a: tally.a + 1 }
        : { ...tally, b: tally.b + 1 }
    },
    { a: 0, b: 0 },
  )
}

export function matchWinnerSide(
  games: readonly Game[],
  stage: FixtureStage,
): Side | null {
  const confirmedWins = games.filter(
    (game) => game.confirmedAt !== null && isGameWon(game.score, stage),
  )
  const tally = matchGameTally(confirmedWins)

  if (tally.a >= 2) {
    return 'a'
  }
  if (tally.b >= 2) {
    return 'b'
  }
  return null
}

/**
 * The winner of a result entered game by game, or null when the games are not
 * a finished best-of-three: every game won under the stage rules, and none
 * played after a side reached two wins.
 */
export function correctedMatchWinner(
  games: readonly Score[],
  stage: FixtureStage,
): Side | null {
  const wins = { a: 0, b: 0 }

  for (const game of games) {
    if (wins.a === 2 || wins.b === 2 || !isGameWon(game, stage)) {
      return null
    }
    wins[game.a > game.b ? 'a' : 'b'] += 1
  }

  if (wins.a === 2) {
    return 'a'
  }
  if (wins.b === 2) {
    return 'b'
  }
  return null
}
