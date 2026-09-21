import type {
  Lineup,
  LineupPair,
  Seed,
  Team,
  TeamPlayer,
  UUID,
} from './types'

export type RosterIssueCode =
  | 'team-count'
  | 'player-count'
  | 'duplicate-player'
  | 'unknown-team'
  | 'team-size'
  | 'seed-split'

export interface RosterIssue {
  code: RosterIssueCode
  teamId?: UUID
  playerId?: UUID
}

export type LineupIssueCode =
  | 'unknown-team'
  | 'unknown-player'
  | 'wrong-team'
  | 'pair-player-repeated'
  | 'same-seed-pair'
  | 'opening-player-repeated'
  | 'opening-players-incomplete'
  | 'decider-repeats-opening-pair'

/** Row 4 is the predeclared qualification playoff pair. */
type PairNumber = 1 | 2 | 3 | 4

export interface LineupIssue {
  code: LineupIssueCode
  matchNumber?: PairNumber
  playerId?: UUID
}

export interface QualifyingRotationIssue {
  code: 'rotation-incomplete'
  teamId: UUID
}

export function validateRoster(
  teams: readonly Team[],
  players: readonly TeamPlayer[],
): RosterIssue[] {
  const issues: RosterIssue[] = []

  if (teams.length !== 4) {
    issues.push({ code: 'team-count' })
  }

  if (players.length !== 16) {
    issues.push({ code: 'player-count' })
  }

  const seenPlayerIds = new Set<UUID>()
  const teamIds = new Set(teams.map((team) => team.id))

  for (const player of players) {
    if (seenPlayerIds.has(player.id)) {
      issues.push({ code: 'duplicate-player', playerId: player.id })
    }
    seenPlayerIds.add(player.id)

    if (!teamIds.has(player.teamId)) {
      issues.push({
        code: 'unknown-team',
        teamId: player.teamId,
        playerId: player.id,
      })
    }
  }

  for (const team of teams) {
    const teamPlayers = players.filter((player) => player.teamId === team.id)
    if (teamPlayers.length !== 4) {
      issues.push({ code: 'team-size', teamId: team.id })
    }

    if (
      countSeed(teamPlayers, 1) !== 2 ||
      countSeed(teamPlayers, 2) !== 2
    ) {
      issues.push({ code: 'seed-split', teamId: team.id })
    }
  }

  return issues
}

/**
 * Checks a declared lineup: pairs 1–3 mix seeds, pairs 1 and 2 use all four
 * players once, pair 3 differs from both, and pair 4 (the playoff pair) is any
 * two distinct teammates. Substitutions are not declared lineups and bypass it.
 */
export function validateLineup(
  lineup: Lineup,
  roster: readonly TeamPlayer[],
): LineupIssue[] {
  const issues: LineupIssue[] = []
  const teamRoster = roster.filter((player) => player.teamId === lineup.teamId)

  if (teamRoster.length === 0) {
    issues.push({ code: 'unknown-team' })
  }

  const rosterById = new Map(roster.map((player) => [player.id, player]))
  lineup.pairs.forEach((pair, index) => {
    validatePair(pair, index + 1 as PairNumber, lineup.teamId, rosterById, issues)
  })

  const openingPlayerIds = lineup.pairs
    .slice(0, 2)
    .flatMap((pair) => [pair.player1Id, pair.player2Id])
  const uniqueOpeningPlayerIds = new Set(openingPlayerIds)

  for (const playerId of uniqueOpeningPlayerIds) {
    if (openingPlayerIds.filter((id) => id === playerId).length > 1) {
      issues.push({ code: 'opening-player-repeated', playerId })
    }
  }

  const teamPlayerIds = new Set(teamRoster.map((player) => player.id))
  if (
    uniqueOpeningPlayerIds.size !== 4 ||
    [...teamPlayerIds].some((playerId) => !uniqueOpeningPlayerIds.has(playerId))
  ) {
    issues.push({ code: 'opening-players-incomplete' })
  }

  const decider = lineup.pairs[2]
  if (
    lineup.pairs
      .slice(0, 2)
      .some((pair) => samePair(pair, decider))
  ) {
    issues.push({ code: 'decider-repeats-opening-pair', matchNumber: 3 })
  }

  return issues
}

/**
 * Checks that each team's declared qualifying lineups use both disjoint
 * mixed-seed arrangements across its fixtures. Pass all of the teams'
 * qualifying lineups; it is a lock-time check and never looks at substitutions.
 */
export function validateQualifyingRotation(
  lineups: readonly Lineup[],
  roster: readonly TeamPlayer[],
): QualifyingRotationIssue[] {
  const teamIds = [...new Set(lineups.map((lineup) => lineup.teamId))]

  return teamIds
    .filter((teamId) => {
      const teamLineups = lineups.filter((lineup) => lineup.teamId === teamId)
      return arrangementCount(teamLineups, roster) < 2
    })
    .map((teamId) => ({ code: 'rotation-incomplete', teamId }))
}

/**
 * A team's two seed 1 players split its seed 2 players between them, so the
 * seed 2 partner of one fixed seed 1 player identifies the arrangement.
 */
function arrangementCount(
  teamLineups: readonly Lineup[],
  roster: readonly TeamPlayer[],
): number {
  const teamId = teamLineups[0]?.teamId
  const seedById = new Map(
    roster
      .filter((player) => player.teamId === teamId)
      .map((player) => [player.id, player.seed]),
  )
  const anchorId = [...seedById]
    .filter(([, seed]) => seed === 1)
    .map(([id]) => id)
    .sort()[0]
  const partnerIds = new Set<UUID>()

  for (const lineup of teamLineups) {
    const anchorPair = lineup.pairs
      .slice(0, 2)
      .find((pair) => pair.player1Id === anchorId || pair.player2Id === anchorId)
    if (!anchorPair) continue

    const partnerId =
      anchorPair.player1Id === anchorId ? anchorPair.player2Id : anchorPair.player1Id
    if (seedById.get(partnerId) === 2) {
      partnerIds.add(partnerId)
    }
  }

  return partnerIds.size
}

function countSeed(players: readonly TeamPlayer[], seed: Seed): number {
  return players.filter((player) => player.seed === seed).length
}

function validatePair(
  pair: LineupPair,
  matchNumber: PairNumber,
  teamId: UUID,
  rosterById: ReadonlyMap<UUID, TeamPlayer>,
  issues: LineupIssue[],
): void {
  if (pair.player1Id === pair.player2Id) {
    issues.push({ code: 'pair-player-repeated', matchNumber, playerId: pair.player1Id })
  }

  const player1 = validatePlayer(pair.player1Id, matchNumber, teamId, rosterById, issues)
  const player2 = validatePlayer(pair.player2Id, matchNumber, teamId, rosterById, issues)

  if (
    matchNumber !== 4 &&
    player1 &&
    player2 &&
    pair.player1Id !== pair.player2Id &&
    player1.seed === player2.seed
  ) {
    issues.push({ code: 'same-seed-pair', matchNumber })
  }
}

function validatePlayer(
  playerId: UUID,
  matchNumber: PairNumber,
  teamId: UUID,
  rosterById: ReadonlyMap<UUID, TeamPlayer>,
  issues: LineupIssue[],
): TeamPlayer | null {
  const player = rosterById.get(playerId)
  if (!player) {
    issues.push({ code: 'unknown-player', matchNumber, playerId })
    return null
  }

  if (player.teamId !== teamId) {
    issues.push({ code: 'wrong-team', matchNumber, playerId })
  }
  return player
}

function samePair(left: LineupPair, right: LineupPair): boolean {
  return (
    (left.player1Id === right.player1Id && left.player2Id === right.player2Id) ||
    (left.player1Id === right.player2Id && left.player2Id === right.player1Id)
  )
}
