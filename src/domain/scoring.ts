import type { FixtureStage, Game, Score, Side } from './types'

const MIN_WINNING_SCORE = 21
const SCORE_CAP = 30

export function isWinningScore(score: Score): boolean {
  const { a, b } = score

  if (
    !Number.isInteger(a) ||
    !Number.isInteger(b) ||
    a < 0 ||
    b < 0 ||
    a > SCORE_CAP ||
    b > SCORE_CAP ||
    a === b
  ) {
    return false
  }

  const winner = Math.max(a, b)
  const loser = Math.min(a, b)

  if (winner === SCORE_CAP) {
    return loser === SCORE_CAP - 1 || loser === SCORE_CAP - 2
  }

  if (winner === MIN_WINNING_SCORE) {
    return loser <= MIN_WINNING_SCORE - 2
  }

  return winner > MIN_WINNING_SCORE && winner < SCORE_CAP && winner - loser === 2
}

export function addPointToScore(score: Score, side: Side): Score {
  if (isWinningScore(score)) {
    return score
  }

  return side === 'a'
    ? { a: score.a + 1, b: score.b }
    : { a: score.a, b: score.b + 1 }
}

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
    return loser === cap - 1
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
