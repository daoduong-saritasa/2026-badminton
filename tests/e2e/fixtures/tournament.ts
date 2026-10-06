import {
  findMatch,
  matchCommand,
  readState,
  tournamentCommand,
  type Fixture,
  type LocalSession,
  type Match,
  type Pair,
  type Side,
  type Snapshot,
} from '../support/api.ts'

/** Team ids in a fixed order, so a builder can name teams by position. */
export function teamOrder(snapshot: Snapshot): [string, string, string, string] {
  const ids = snapshot.teams.map((team) => team.id).sort()
  if (ids.length !== 4) throw new Error(`Expected 4 teams, found ${ids.length}`)
  return [ids[0], ids[1], ids[2], ids[3]]
}

export function teamName(snapshot: Snapshot, teamId: string): string {
  const team = snapshot.teams.find((candidate) => candidate.id === teamId)
  if (!team) throw new Error(`Team ${teamId} is not in the snapshot`)
  return team.name
}

export function playerName(snapshot: Snapshot, playerId: string): string {
  const player = snapshot.players.find((candidate) => candidate.id === playerId)
  if (!player) throw new Error(`Player ${playerId} is not in the snapshot`)
  return player.name
}

/** A pair as the interface writes it: "first / second". */
export function pairLabel(snapshot: Snapshot, pair: Pair): string {
  return `${playerName(snapshot, pair.player1Id)} / ${playerName(snapshot, pair.player2Id)}`
}

export function fixtureMatches(snapshot: Snapshot, fixtureId: string): Match[] {
  return snapshot.matches
    .filter((match) => match.fixture_id === fixtureId)
    .sort((first, second) => first.match_number - second.match_number)
}

export function fixturesIn(snapshot: Snapshot, stage: Fixture['stage']): Fixture[] {
  return snapshot.fixtures.filter((fixture) => fixture.stage === stage)
}

export function onlyFixture(snapshot: Snapshot, stage: 'third-place' | 'final'): Fixture {
  const [fixture] = fixturesIn(snapshot, stage)
  if (!fixture) throw new Error(`The ${stage} fixture is missing`)
  return fixture
}

export function fixtureOf(snapshot: Snapshot, match: Match): Fixture {
  const fixture = snapshot.fixtures.find((candidate) => candidate.id === match.fixture_id)
  if (!fixture) throw new Error(`Match ${match.id} has no fixture`)
  return fixture
}

export function sideTeam(snapshot: Snapshot, match: Match, side: Side): string {
  const fixture = fixtureOf(snapshot, match)
  const teamId = side === 'a' ? fixture.team_a_id : fixture.team_b_id
  if (!teamId) throw new Error(`Match ${match.id} side ${side} has no team yet`)
  return teamId
}

/** A team's players split by seed, each list in a fixed order. */
export function seeds(snapshot: Snapshot, teamId: string): { seed1: [string, string]; seed2: [string, string] } {
  const players = snapshot.players.filter((player) => player.team_id === teamId).sort((a, b) => a.id.localeCompare(b.id))
  const seed1 = players.filter((player) => player.seed === 1).map((player) => player.id)
  const seed2 = players.filter((player) => player.seed === 2).map((player) => player.id)
  if (seed1.length !== 2 || seed2.length !== 2) throw new Error(`Team ${teamId} does not have two players at each seed`)
  return { seed1: [seed1[0], seed1[1]], seed2: [seed2[0], seed2[1]] }
}

/**
 * A mixed-seed pair. Index 0 and 1 use disjoint players, so a fixture's two
 * simultaneous matches never share a player.
 */
export function mixedPair(snapshot: Snapshot, teamId: string, index: 0 | 1): Pair {
  const { seed1, seed2 } = seeds(snapshot, teamId)
  return { player1Id: seed1[index], player2Id: seed2[index] }
}

export async function startQualifying(organizer: LocalSession): Promise<Snapshot> {
  await tournamentCommand(organizer, 'start_qualifying', {})
  return (await readState()).snapshot
}

export async function assignCourt(organizer: LocalSession, matchId: string, court: 1 | 2): Promise<void> {
  await tournamentCommand(organizer, 'assign_courts', { assignments: [{ matchId, court }] })
}

export async function assignPair(
  session: LocalSession,
  matchId: string,
  side: Side,
  pair: Pair,
  ruleException = false,
): Promise<void> {
  await matchCommand(session, 'assign_pair', matchId, { side, ruleException, ...pair })
}

/**
 * Assigns the court and both pairs a match needs to start. Matches 1 and 2 use
 * disjoint mixed pairs; a decider reuses the first arrangement.
 */
export async function prepareMatch(organizer: LocalSession, matchId: string, court: 1 | 2): Promise<void> {
  await assignCourt(organizer, matchId, court)
  for (const side of ['a', 'b'] as const) {
    const { snapshot } = await readState()
    const match = findMatch(snapshot, matchId)
    const index = match.match_number === 2 ? 1 : 0
    await assignPair(organizer, matchId, side, mixedPair(snapshot, sideTeam(snapshot, match, side), index))
  }
}

/** Scores one game point by point from 0–0 and confirms it. */
async function scoreGame(scorer: LocalSession, matchId: string, a: number, b: number): Promise<void> {
  const points: Side[] = []
  const shared = Math.min(a, b)
  for (let point = 0; point < shared; point += 1) points.push('a', 'b')
  for (let point = shared; point < Math.max(a, b); point += 1) points.push(a > b ? 'a' : 'b')

  let version = findMatch((await readState()).snapshot, matchId).version
  for (const side of points) {
    const receipt = await matchCommand(scorer, 'add_point', matchId, { side }, version)
    version = receipt.matchVersion ?? version + 1
  }
  await matchCommand(scorer, 'confirm_game', matchId, {}, version)
}

/**
 * Starts a prepared match as `scorer` and plays `games` to completion. Each
 * entry is one game's final score as [side a, side b].
 */
export async function playMatch(
  scorer: LocalSession,
  matchId: string,
  games: ReadonlyArray<readonly [number, number]>,
): Promise<void> {
  await matchCommand(scorer, 'start_match', matchId)
  for (const [a, b] of games) await scoreGame(scorer, matchId, a, b)
}

export async function walkover(organizer: LocalSession, matchId: string, winnerSide: Side): Promise<void> {
  await matchCommand(organizer, 'mark_walkover', matchId, { winnerSide })
}

export type FixtureOutcome = 'a' | 'b' | 'split'

/**
 * Decides every qualifying fixture by walkovers. `outcome` receives the
 * fixture's teams by position in `teamOrder` and says which side wins both
 * matches, or `split` for one each.
 */
export async function decideQualifying(
  organizer: LocalSession,
  outcome: (teamA: number, teamB: number) => FixtureOutcome,
): Promise<Snapshot> {
  const { snapshot } = await readState()
  const order = teamOrder(snapshot)
  for (const fixture of fixturesIn(snapshot, 'qualifying')) {
    const result = outcome(order.indexOf(fixture.team_a_id ?? ''), order.indexOf(fixture.team_b_id ?? ''))
    const [first, second] = fixtureMatches(snapshot, fixture.id)
    await walkover(organizer, first.id, result === 'b' ? 'b' : 'a')
    await walkover(organizer, second.id, result === 'a' ? 'a' : 'b')
  }
  return (await readState()).snapshot
}

/** The lower-positioned team wins every fixture: finalists are positions 0 and 1. */
export function clearStandings(teamA: number, teamB: number): FixtureOutcome {
  return teamA < teamB ? 'a' : 'b'
}

function winnerByPosition(teamA: number, teamB: number, winner: number): FixtureOutcome {
  return teamA === winner ? 'a' : teamB === winner ? 'b' : 'split'
}

/** Position 0 wins everything; 1 and 2 split and both beat 3, so they tie for second. */
export function twoTeamTie(teamA: number, teamB: number): FixtureOutcome {
  if (teamA === 0 || teamB === 0) return winnerByPosition(teamA, teamB, 0)
  if (teamA === 3 || teamB === 3) return teamA === 3 ? 'b' : 'a'
  return 'split'
}

/** Position 3 loses everything; 0, 1, and 2 split, so all three tie for two places. */
export function threeTeamTie(teamA: number, teamB: number): FixtureOutcome {
  if (teamA === 3 || teamB === 3) return teamA === 3 ? 'b' : 'a'
  return 'split'
}

/** Every fixture splits, so all four teams tie. */
export function fourTeamTie(): FixtureOutcome {
  return 'split'
}

export async function confirmFinalists(organizer: LocalSession): Promise<Snapshot> {
  await tournamentCommand(organizer, 'confirm_finalists', {})
  return (await readState()).snapshot
}
