import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  anonymousRpc,
  elevate,
  type LocalSession,
  mutation,
  requireLocalSupabase,
  resetLocalDatabase,
  rpc,
  runSql,
  signInAnonymously,
} from './local-supabase.ts'

interface Receipt {
  matchId: string | null
  matchVersion: number | null
  tournamentVersion: number
}

interface Team {
  id: string
  name: string
}

interface Player {
  id: string
  seed: 1 | 2
  team_id: string
}

interface Fixture {
  id: string
  stage: 'qualifying' | 'qualification-playoff' | 'third-place' | 'final'
  team_a_id: string | null
  team_b_id: string | null
  version: number
}

interface Match {
  court: 1 | 2 | null
  fixture_id: string
  id: string
  match_number: 1 | 2 | 3
  pair_a_player_1_id: string | null
  pair_a_player_2_id: string | null
  pair_b_player_1_id: string | null
  pair_b_player_2_id: string | null
  state: 'unstarted' | 'playing' | 'completed' | 'unnecessary'
  version: number
  winner_side: 'a' | 'b' | null
}

interface Snapshot {
  fixtures: Fixture[]
  games: Array<{
    confirmed_at: string | null
    game_number: number
    match_id: string
    score_a: number
    score_b: number
  }>
  matches: Match[]
  players: Player[]
  teams: Team[]
  tournament: {
    finalists_confirmed_at: string | null
    id: string
    name: string
    result_revision: number
    stage: 'setup' | 'groups' | 'knockouts' | 'completed'
    version: number
  }
}

interface TournamentState {
  resetGeneration: number
  snapshot: Snapshot | null
}

function rosterPayload(): Record<string, unknown> {
  return {
    tournamentName: 'Team integration',
    teams: Array.from({ length: 4 }, (_, teamIndex) => ({
      name: `Team ${teamIndex + 1}`,
      players: Array.from({ length: 4 }, (_, playerIndex) => ({
        name: `Player ${teamIndex + 1}-${playerIndex + 1}`,
        seed: playerIndex < 2 ? 1 : 2,
      })),
    })),
  }
}

async function state(session?: LocalSession): Promise<TournamentState> {
  const response = session
    ? await rpc('get_tournament_snapshot', {}, session)
    : await anonymousRpc('get_tournament_snapshot', {})
  expect(response.ok).toBe(true)
  return (await response.json()) as TournamentState
}

async function snapshot(session?: LocalSession): Promise<Snapshot> {
  const current = await state(session)
  if (!current.snapshot) throw new Error('Tournament snapshot is empty')
  return current.snapshot
}

async function callMutation(
  operation: string,
  session: LocalSession,
  expectedVersion: number,
  payload: Record<string, unknown>,
): Promise<Receipt> {
  const response = await rpc(operation, mutation(expectedVersion, payload), session)
  expect(response.ok, `${operation} returned ${response.status}`).toBe(true)
  return (await response.json()) as Receipt
}

async function createRoster(session: LocalSession): Promise<Snapshot> {
  await callMutation('save_roster', session, 0, rosterPayload())
  return snapshot(session)
}

/** Starts qualifying on the existing roster; no pair is declared in advance. */
async function beginQualifying(session: LocalSession): Promise<Snapshot> {
  const current = await snapshot(session)
  await callMutation('start_qualifying', session, current.tournament.version, {})
  return snapshot(session)
}

async function startQualifying(session: LocalSession): Promise<Snapshot> {
  await createRoster(session)
  return beginQualifying(session)
}

/**
 * The mixed-seed pair for one team in one match: match 1 takes the first seed
 * 1 and seed 2 players and match 2 the others, so a fixture uses all four.
 */
function mixedPair(current: Snapshot, teamId: string, matchNumber: number) {
  const players = current.players.filter((player) => player.team_id === teamId)
  const seed1 = players.filter((player) => player.seed === 1)
  const seed2 = players.filter((player) => player.seed === 2)
  const index = matchNumber === 2 ? 1 : 0
  return { player1Id: seed1[index].id, player2Id: seed2[index].id }
}

async function assignPairs(session: LocalSession, matchId: string): Promise<Match> {
  for (const side of ['a', 'b'] as const) {
    const current = await snapshot(session)
    const target = current.matches.find((match) => match.id === matchId)
    const fixture = current.fixtures.find((candidate) => candidate.id === target?.fixture_id)
    const teamId = side === 'a' ? fixture?.team_a_id : fixture?.team_b_id
    if (!target || !teamId) throw new Error('Match side is not assignable')
    await callMutation('assign_pair', session, target.version, {
      matchId,
      side,
      ruleException: false,
      ...mixedPair(current, teamId, target.match_number),
    })
  }
  const assigned = (await snapshot(session)).matches.find((match) => match.id === matchId)
  if (!assigned) throw new Error('Assigned match vanished')
  return assigned
}

function stageFixtures(current: Snapshot, stage: Fixture['stage']): Fixture[] {
  return current.fixtures.filter((fixture) => fixture.stage === stage)
}

function fixtureMatches(current: Snapshot, fixtureId: string): Match[] {
  return current.matches
    .filter((match) => match.fixture_id === fixtureId)
    .sort((first, second) => first.match_number - second.match_number)
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json()) as { message?: unknown }
  return typeof body.message === 'string' ? body.message : ''
}

async function assignCourt(session: LocalSession, matchId: string, court: 1 | 2): Promise<Match> {
  const current = await snapshot(session)
  await callMutation('assign_courts', session, current.tournament.version, {
    assignments: [{ matchId, court }],
  })
  const assigned = (await snapshot(session)).matches.find((match) => match.id === matchId)
  if (!assigned) throw new Error('Assigned match vanished')
  return assigned
}

async function walkover(session: LocalSession, matchId: string, winnerSide: 'a' | 'b'): Promise<void> {
  const target = (await snapshot(session)).matches.find((match) => match.id === matchId)
  if (!target) throw new Error('Walkover match is missing')
  await callMutation('mark_walkover', session, target.version, { matchId, winnerSide })
}

describe('team tournament commands', () => {
  beforeAll(async () => {
    await requireLocalSupabase()
  })

  beforeEach(() => {
    resetLocalDatabase()
  })

  it('validates four complete rosters and pairs every team once in qualifying', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)
    const invalid = rosterPayload()
    ;(invalid.teams as Array<{ players: unknown[] }>)[0].players.pop()
    expect((await rpc('save_roster', mutation(0, invalid), organizer)).ok).toBe(false)

    const created = await createRoster(organizer)
    expect(created.teams).toHaveLength(4)
    expect(created.players).toHaveLength(16)
    const qualifying = stageFixtures(created, 'qualifying')
    expect(qualifying).toHaveLength(6)
    const pairings = qualifying.map((fixture) => [fixture.team_a_id, fixture.team_b_id].sort().join(':'))
    expect(new Set(pairings).size).toBe(6)
    for (const team of created.teams) {
      expect(qualifying.filter((fixture) => fixture.team_a_id === team.id || fixture.team_b_id === team.id)).toHaveLength(3)
    }
    expect(created.fixtures.filter((fixture) => fixture.stage !== 'qualifying').map((fixture) => fixture.stage).sort())
      .toEqual(['final', 'third-place'])
    expect(created.matches).toEqual([])
  })

  it('publishes each saved side immediately and freezes pairs once the match starts', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)
    const ready = await startQualifying(organizer)
    const fixture = stageFixtures(ready, 'qualifying')[0]
    const [first] = fixtureMatches(ready, fixture.id)
    if (!fixture.team_a_id || !first) throw new Error('Qualifying match is missing')

    await callMutation('assign_pair', organizer, first.version, {
      matchId: first.id,
      side: 'a',
      ruleException: false,
      ...mixedPair(ready, fixture.team_a_id, 1),
    })
    const published = (await snapshot()).matches.find((match) => match.id === first.id)
    expect(published).toMatchObject({
      pair_a_player_1_id: mixedPair(ready, fixture.team_a_id, 1).player1Id,
      pair_b_player_1_id: null,
    })

    const withCourt = await assignCourt(organizer, first.id, 1)
    const halfReady = await rpc('start_match', mutation(withCourt.version, { matchId: first.id }), organizer)
    expect(halfReady.ok).toBe(false)
    expect(await errorMessage(halfReady)).toBe('Match is not ready to start')

    const assigned = await assignPairs(organizer, first.id)
    await callMutation('start_match', organizer, assigned.version, { matchId: first.id })
    const started = (await snapshot(organizer)).matches.find((match) => match.id === first.id)
    const frozen = await rpc('assign_pair', mutation(started?.version ?? -1, {
      matchId: first.id,
      side: 'a',
      ruleException: false,
      ...mixedPair(ready, fixture.team_a_id, 2),
    }), organizer)
    expect(frozen.ok).toBe(false)
    expect(await errorMessage(frozen)).toBe('Pairs are fixed after the match starts')
  })

  it('removes the lineup, substitution, and advancement draw surface', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)
    for (const operation of ['save_lineup', 'confirm_lineup', 'reopen_lineups', 'substitute_players']) {
      expect((await rpc(operation, mutation(0, {}), organizer)).status).toBe(404)
    }
    expect(runSql("select to_regclass('private.lineups') is null;")).toBe('t')
    expect(runSql(`
      select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'tournament'
        and column_name = 'qualification_draw_winner_ids';
    `)).toBe('0')
  })

  it('enforces stage scoring rules and completes a one-game match', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)
    expect(runSql("select private.is_game_won(21, 20, 'qualifying');")).toBe('f')
    expect(runSql("select private.is_game_won(21, 19, 'qualifying');")).toBe('t')
    expect(runSql("select private.is_game_won(15, 13, 'third-place');")).toBe('t')
    expect(runSql("select private.is_game_won(15, 14, 'third-place');")).toBe('f')
    expect(runSql("select private.is_game_won(21, 20, 'third-place');")).toBe('t')
    expect(runSql("select private.is_game_won(30, 29, 'third-place');")).toBe('f')
    expect(runSql("select private.is_game_won(11, 9, 'qualification-playoff');")).toBe('t')
    expect(runSql("select private.is_game_won(14, 13, 'qualification-playoff');")).toBe('f')
    expect(runSql("select private.is_game_won(15, 14, 'qualification-playoff');")).toBe('t')
    expect(runSql("select private.is_game_won(30, 28, 'final');")).toBe('t')

    const qualifying = await startQualifying(organizer)
    await assignCourt(organizer, qualifying.matches[0].id, 1)
    const assigned = await assignPairs(organizer, qualifying.matches[0].id)
    await callMutation('start_match', organizer, assigned.version, { matchId: assigned.id })
    runSql(`update public.match_games set score_a = 21, score_b = 19 where match_id = '${assigned.id}'::uuid and confirmed_at is null;`)
    const won = (await snapshot(organizer)).matches.find((match) => match.id === assigned.id)
    expect((await rpc('add_point', mutation(won?.version ?? -1, {
      matchId: assigned.id,
      side: 'a',
    }), organizer)).ok).toBe(false)
    await callMutation('confirm_game', organizer, won?.version ?? -1, { matchId: assigned.id })
    expect((await snapshot(organizer)).matches.find((match) => match.id === assigned.id)).toMatchObject({
      state: 'completed',
      winner_side: 'a',
    })
  })

  it('lets a qualifying fixture finish level with no third match', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)
    const qualifying = await startQualifying(organizer)
    const fixture = stageFixtures(qualifying, 'qualifying')[0]
    const matches = fixtureMatches(qualifying, fixture.id)
    expect(matches.map((match) => match.match_number)).toEqual([1, 2])

    await walkover(organizer, matches[0].id, 'a')
    await walkover(organizer, matches[1].id, 'b')
    expect(fixtureMatches(await snapshot(organizer), fixture.id).map((match) => [match.state, match.winner_side]))
      .toEqual([['completed', 'a'], ['completed', 'b']])
  })

  it('blocks occupied courts and rejects writes from a former owner', async () => {
    const organizer = await signInAnonymously()
    const referee = await signInAnonymously()
    await elevate(organizer)
    await elevate(referee, '1357')
    const qualifying = await startQualifying(organizer)
    await assignCourt(organizer, qualifying.matches[0].id, 1)
    const first = await assignPairs(organizer, qualifying.matches[0].id)
    await callMutation('start_match', organizer, first.version, { matchId: first.id })

    // A fixture sharing no team, so only the occupied court can block the start.
    const firstFixture = qualifying.fixtures.find((fixture) => fixture.id === first.fixture_id)
    const busyTeams = [firstFixture?.team_a_id, firstFixture?.team_b_id]
    const freeFixture = stageFixtures(qualifying, 'qualifying').find((fixture) =>
      !busyTeams.includes(fixture.team_a_id) && !busyTeams.includes(fixture.team_b_id))
    const other = freeFixture ? fixtureMatches(qualifying, freeFixture.id)[0] : undefined
    if (!other) throw new Error('Second match is missing')
    await assignCourt(organizer, other.id, 1)
    const assignedOther = await assignPairs(organizer, other.id)
    expect((await rpc('start_match', mutation(assignedOther.version, { matchId: assignedOther.id }), referee)).ok).toBe(false)

    const playing = (await snapshot(organizer)).matches.find((match) => match.id === first.id)
    if (!playing) throw new Error('Playing match vanished')
    const handover = await callMutation('take_over', referee, playing.version, { matchId: playing.id })
    expect(runSql(`select count(*) from private.scoring_handovers where match_id = '${playing.id}'::uuid;`)).toBe('1')
    expect((await rpc('add_point', mutation(handover.matchVersion ?? -1, { matchId: playing.id, side: 'a' }), organizer)).ok).toBe(false)
    expect((await rpc('add_point', mutation(handover.matchVersion ?? -1, { matchId: playing.id, side: 'a' }), referee)).ok).toBe(true)
  })

  it('confirms finalists, plays third place before the final, and completes after both', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)
    const qualifying = await startQualifying(organizer)
    // Side a always wins, so the standings separate on total match wins.
    for (const fixture of stageFixtures(qualifying, 'qualifying')) {
      for (const match of fixtureMatches(qualifying, fixture.id)) {
        await walkover(organizer, match.id, 'a')
      }
    }

    let progressed = await snapshot(organizer)
    const placement = progressed.fixtures.filter((fixture) => fixture.stage === 'third-place' || fixture.stage === 'final')
    expect(placement.every((fixture) => fixture.team_a_id !== null && fixture.team_b_id !== null)).toBe(true)
    const thirdPlace = placement.find((fixture) => fixture.stage === 'third-place')
    const final = placement.find((fixture) => fixture.stage === 'final')
    if (!thirdPlace?.team_a_id || !final?.team_a_id) throw new Error('Placement fixtures are missing')
    // Placement matches open for pair assignment only after finalist confirmation.
    expect(fixtureMatches(progressed, final.id)).toEqual([])

    await callMutation('confirm_finalists', organizer, progressed.tournament.version, {})
    expect((await snapshot(organizer)).tournament).toMatchObject({ stage: 'knockouts' })
    progressed = await snapshot(organizer)
    const finalMatches = fixtureMatches(progressed, final.id)
    expect(finalMatches).toHaveLength(3)

    await assignCourt(organizer, finalMatches[0].id, 1)
    const earlyFinal = await assignPairs(organizer, finalMatches[0].id)
    const blocked = await rpc('start_match', mutation(earlyFinal.version, { matchId: earlyFinal.id }), organizer)
    expect(blocked.ok).toBe(false)
    expect(await errorMessage(blocked)).toBe('Third place must finish before the final starts')

    const thirdMatches = fixtureMatches(progressed, thirdPlace.id)
    await walkover(organizer, thirdMatches[0].id, 'a')
    await walkover(organizer, thirdMatches[1].id, 'a')
    expect((await snapshot(organizer)).matches.find((match) => match.id === thirdMatches[2].id)?.state).toBe('unnecessary')
    expect((await snapshot(organizer)).tournament.stage).not.toBe('completed')

    await walkover(organizer, finalMatches[0].id, 'a')
    await walkover(organizer, finalMatches[1].id, 'b')
    await walkover(organizer, finalMatches[2].id, 'a')
    expect((await snapshot(organizer)).tournament.stage).toBe('completed')
  })
})
