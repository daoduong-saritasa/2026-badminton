import type {
  Group,
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
  | 'group-split'

export interface RosterIssue {
  code: RosterIssueCode
  teamId?: UUID
  playerId?: UUID
  group?: Group
}

export type LineupIssueCode =
  | 'unknown-team'
  | 'unknown-player'
  | 'wrong-team'
  | 'wrong-seed'
  | 'opening-player-repeated'
  | 'opening-players-incomplete'
  | 'decider-repeats-opening-pair'

export interface LineupIssue {
  code: LineupIssueCode
  matchNumber?: 1 | 2 | 3
  playerId?: UUID
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

  for (const group of ['A', 'B'] as const) {
    if (teams.filter((team) => team.group === group).length !== 2) {
      issues.push({ code: 'group-split', group })
    }
  }

  return issues
}

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
    validatePair(pair, index + 1 as 1 | 2 | 3, lineup.teamId, rosterById, issues)
  })

  const openingPlayerIds = lineup.pairs
    .slice(0, 2)
    .flatMap((pair) => [pair.seed1PlayerId, pair.seed2PlayerId])
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

function countSeed(players: readonly TeamPlayer[], seed: Seed): number {
  return players.filter((player) => player.seed === seed).length
}

function validatePair(
  pair: LineupPair,
  matchNumber: 1 | 2 | 3,
  teamId: UUID,
  rosterById: ReadonlyMap<UUID, TeamPlayer>,
  issues: LineupIssue[],
): void {
  validatePlayer(pair.seed1PlayerId, 1, matchNumber, teamId, rosterById, issues)
  validatePlayer(pair.seed2PlayerId, 2, matchNumber, teamId, rosterById, issues)
}

function validatePlayer(
  playerId: UUID,
  expectedSeed: Seed,
  matchNumber: 1 | 2 | 3,
  teamId: UUID,
  rosterById: ReadonlyMap<UUID, TeamPlayer>,
  issues: LineupIssue[],
): void {
  const player = rosterById.get(playerId)
  if (!player) {
    issues.push({ code: 'unknown-player', matchNumber, playerId })
    return
  }

  if (player.teamId !== teamId) {
    issues.push({ code: 'wrong-team', matchNumber, playerId })
  }
  if (player.seed !== expectedSeed) {
    issues.push({ code: 'wrong-seed', matchNumber, playerId })
  }
}

function samePair(left: LineupPair, right: LineupPair): boolean {
  return (
    left.seed1PlayerId === right.seed1PlayerId &&
    left.seed2PlayerId === right.seed2PlayerId
  )
}
