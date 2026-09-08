import type { Score, Side } from './types'

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
