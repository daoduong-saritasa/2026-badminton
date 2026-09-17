import { deciderStatus, fixtureTally } from '@/domain/team-fixtures'
import type {
  FixtureMatch,
  Group,
  Lineup,
  LineupPair,
  Score,
  Side,
  TeamFixture,
  TournamentSnapshot,
  UUID,
} from '@/domain/types'
import { formatNumber } from '@/i18n/format'
import { messages } from '@/i18n/vi'

/** Group colour, shared by the ticket head, the fixture cards and the schedule. */
export function groupTone(group: Group): string {
  return group === 'A' ? 'bg-mist text-navy' : 'bg-ice text-ink'
}

export function teamName(snapshot: TournamentSnapshot, teamId: UUID | null): string {
  if (teamId === null) return messages.common.toBeDecided
  return snapshot.teams.find((team) => team.id === teamId)?.name ?? messages.common.unknownTeam
}

export function playerName(snapshot: TournamentSnapshot, playerId: UUID): string {
  return snapshot.players.find((player) => player.id === playerId)?.name ?? messages.common.unknownPlayer
}

export function pairPlayers(snapshot: TournamentSnapshot, pair: LineupPair | null): string {
  if (pair === null) return messages.common.pairPending
  return messages.common.pair(playerName(snapshot, pair.seed1PlayerId), playerName(snapshot, pair.seed2PlayerId))
}

export function fixtureOf(snapshot: TournamentSnapshot, match: FixtureMatch): TeamFixture | undefined {
  return snapshot.fixtures.find((fixture) => fixture.id === match.fixtureId)
}

export function sideTeamId(fixture: TeamFixture | undefined, side: Side): UUID | null {
  if (!fixture) return null
  return side === 'a' ? fixture.teamAId : fixture.teamBId
}

/** "Bảng A" / "Tranh hạng ba" / "Chung kết". */
export function fixtureLabel(fixture: TeamFixture | undefined): string {
  if (!fixture) return messages.common.unknownFixture
  if (fixture.stage === 'group') return messages.common.group(fixture.group ?? '')
  return messages.stages[fixture.stage]
}

/** "Bảng A · Trận 2": which contest a match belongs to, for lists and labels. */
export function matchLabel(snapshot: TournamentSnapshot, match: FixtureMatch): string {
  return messages.common.fixtureMatch(fixtureLabel(fixtureOf(snapshot, match)), match.matchNumber)
}

export function scoreText(score: Score): string {
  return `${formatNumber(score.a)}–${formatNumber(score.b)}`
}

/** The unconfirmed game a live match is scoring, if any. */
export function openGame(match: FixtureMatch) {
  return match.games.findLast((game) => game.confirmedAt === null)
}

export function confirmedGames(match: FixtureMatch) {
  return match.games.filter((game) => game.confirmedAt !== null)
}

/** "15–10, 12–15, 15–13", "Xử thắng", or the state when nothing was scored. */
export function matchResultText(snapshot: TournamentSnapshot, match: FixtureMatch): string {
  if (match.state === 'completed' && match.resultKind === 'walkover') {
    return messages.matchState.walkover(teamName(snapshot, sideTeamId(fixtureOf(snapshot, match), match.winnerSide ?? 'a')))
  }
  const games = confirmedGames(match)
  if (match.state === 'completed' || games.length > 0) {
    const text = games.map((game) => scoreText(game.score)).join(', ')
    if (match.state !== 'playing') return text
    const open = openGame(match)
    return open ? [text, messages.matchState.liveGame(scoreText(open.score))].filter(Boolean).join(', ') : text
  }
  if (match.state === 'playing') {
    const open = openGame(match)
    return open ? messages.matchState.liveGame(scoreText(open.score)) : messages.matchState.playing
  }
  return messages.matchState[match.state]
}

export function fixtureMatches(snapshot: TournamentSnapshot, fixtureId: UUID): FixtureMatch[] {
  return snapshot.matches
    .filter((match) => match.fixtureId === fixtureId)
    .toSorted((first, second) => first.matchNumber - second.matchNumber)
}

export function fixtureScore(snapshot: TournamentSnapshot, fixtureId: UUID): Score {
  return fixtureTally(fixtureMatches(snapshot, fixtureId))
}

export function isDeciderEligible(snapshot: TournamentSnapshot, match: FixtureMatch): boolean {
  return match.matchNumber !== 3 || deciderStatus(fixtureMatches(snapshot, match.fixtureId)) === 'eligible'
}

/**
 * Lineups both teams confirmed. An organizer's snapshot also carries drafts,
 * which a public view must not show as if they were published.
 */
export function revealedLineups(snapshot: TournamentSnapshot, fixture: TeamFixture): Lineup[] {
  const lineups = snapshot.lineups.filter(
    (lineup) => lineup.fixtureId === fixture.id && lineup.confirmedAt !== null,
  )
  return lineups.length === 2 ? lineups : []
}

/** A match's pairs, or the revealed lineup's pairs before the match row carries them. */
export function matchPair(snapshot: TournamentSnapshot, match: FixtureMatch, side: Side): LineupPair | null {
  const pair = side === 'a' ? match.pairA : match.pairB
  if (pair !== null) return pair
  const fixture = fixtureOf(snapshot, match)
  const teamId = sideTeamId(fixture, side)
  if (!fixture || teamId === null) return null
  const lineup = revealedLineups(snapshot, fixture).find((candidate) => candidate.teamId === teamId)
  return lineup?.pairs[match.matchNumber - 1] ?? null
}
