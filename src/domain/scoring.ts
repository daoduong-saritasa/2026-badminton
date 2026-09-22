import type { FixtureStage, Game, Score, Side } from './types'

export function gameRules(stage: FixtureStage): { target: number; cap: number } {
  switch (stage) {
    case 'qualification-playoff':
      return { target: 11, cap: 15 }
    case 'third-place':
      return { target: 15, cap: 21 }
    default:
      return { target: 21, cap: 30 }
  }
}

/** Placement matches are best of three games; every other match is one game. */
export function gamesToWinMatch(stage: FixtureStage): 1 | 2 {
  return stage === 'final' || stage === 'third-place' ? 2 : 1
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
  const needed = gamesToWinMatch(stage)

  if (tally.a >= needed) {
    return 'a'
  }
  if (tally.b >= needed) {
    return 'b'
  }
  return null
}

/**
 * The winner of a result entered game by game, or null when the games are not
 * a finished match: every game won under the stage rules, and none played
 * after a side reached the wins the stage requires.
 */
export function correctedMatchWinner(
  games: readonly Score[],
  stage: FixtureStage,
): Side | null {
  const needed = gamesToWinMatch(stage)
  const wins = { a: 0, b: 0 }

  for (const game of games) {
    if (wins.a === needed || wins.b === needed || !isGameWon(game, stage)) {
      return null
    }
    wins[game.a > game.b ? 'a' : 'b'] += 1
  }

  if (wins.a === needed) {
    return 'a'
  }
  if (wins.b === needed) {
    return 'b'
  }
  return null
}
