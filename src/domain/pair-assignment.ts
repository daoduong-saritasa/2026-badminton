import type {
  FixtureStage,
  Pair,
  PairAssignmentIssue,
  PairingRule,
  Side,
  TeamPlayer,
  TournamentSnapshot,
  UUID,
} from './types'

export function pairingRule(
  stage: FixtureStage,
  matchNumber: 1 | 2 | 3,
): PairingRule {
  return stage === 'qualifying' || (stage === 'third-place' && matchNumber < 3)
    ? 'mixed-seed'
    : 'free'
}

export function validatePairAssignment(
  snapshot: TournamentSnapshot,
  matchId: UUID,
  side: Side,
  pair: Pair,
): PairAssignmentIssue[] {
  const match = snapshot.matches.find((candidate) => candidate.id === matchId)
  if (!match) throw new Error(`Unknown match ${matchId}`)

  const fixture = snapshot.fixtures.find((candidate) => candidate.id === match.fixtureId)
  if (!fixture) throw new Error(`Unknown fixture ${match.fixtureId}`)

  const teamId = side === 'a' ? fixture.teamAId : fixture.teamBId
  if (!teamId) throw new Error(`Match ${matchId} has no team on side ${side}`)

  const issues: PairAssignmentIssue[] = []
  if (pair.player1Id === pair.player2Id) {
    issues.push({ code: 'duplicate-player', overridable: false })
  }

  const playersById = new Map(snapshot.players.map((player) => [player.id, player]))
  const players = [playersById.get(pair.player1Id), playersById.get(pair.player2Id)]
  if (players.some((player) => !player)) {
    issues.push({ code: 'unknown-player', overridable: false })
  }
  if (players.some((player) => player && player.teamId !== teamId)) {
    issues.push({ code: 'wrong-team', overridable: false })
  }

  const selectedIds = new Set([pair.player1Id, pair.player2Id])
  if (snapshot.matches.some((candidate) =>
    candidate.state === 'playing' && pairIds(candidate.pairA, candidate.pairB)
      .some((playerId) => selectedIds.has(playerId)))) {
    issues.push({ code: 'player-playing', overridable: false })
  }

  if (
    players[0] &&
    players[1] &&
    players[0].seed === players[1].seed &&
    pairingRule(fixture.stage, match.matchNumber) === 'mixed-seed'
  ) {
    issues.push({ code: 'same-seed', overridable: true })
  }

  if (fixture.stage === 'qualifying') {
    const siblingPlayerIds = snapshot.matches
      .filter((candidate) => candidate.fixtureId === fixture.id && candidate.id !== match.id)
      .flatMap((candidate) => pairIds(side === 'a' ? candidate.pairA : candidate.pairB))
    if (siblingPlayerIds.some((playerId) => selectedIds.has(playerId))) {
      issues.push({ code: 'qualifying-player-reused', overridable: true })
    }
  }

  return issues
}

export function qualifyingPairings(
  players: readonly TeamPlayer[],
  teamId: UUID,
): [Pair, Pair][] {
  const teamPlayers = players.filter((player) => player.teamId === teamId)
  const seed1 = teamPlayers.filter((player) => player.seed === 1).toSorted(byId)
  const seed2 = teamPlayers.filter((player) => player.seed === 2).toSorted(byId)
  if (teamPlayers.length !== 4 || seed1.length !== 2 || seed2.length !== 2) return []

  return [
    [pair(seed1[0], seed2[0]), pair(seed1[1], seed2[1])],
    [pair(seed1[0], seed2[1]), pair(seed1[1], seed2[0])],
  ]
}

function pair(player1: TeamPlayer, player2: TeamPlayer): Pair {
  return { player1Id: player1.id, player2Id: player2.id }
}

function byId(left: TeamPlayer, right: TeamPlayer): number {
  return left.id.localeCompare(right.id)
}

function pairIds(...pairs: Array<Pair | null>): UUID[] {
  return pairs.flatMap((candidate) =>
    candidate ? [candidate.player1Id, candidate.player2Id] : [])
}
