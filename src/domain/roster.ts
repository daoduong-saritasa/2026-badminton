import type {
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

function countSeed(players: readonly TeamPlayer[], seed: Seed): number {
  return players.filter((player) => player.seed === seed).length
}
