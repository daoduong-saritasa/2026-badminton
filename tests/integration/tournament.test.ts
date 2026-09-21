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
  lineups: Array<{ fixtureId: string; teamId: string }>
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

/**
 * Pairs 1–3 mix seeds and pairs 1 and 2 use all four players; pair 4 is the
 * predeclared playoff pair, the same two seed 1 players in every fixture.
 */
function lineupPayload(current: Snapshot, fixture: Fixture, teamId: string) {
  const players = current.players.filter((player) => player.team_id === teamId)
  const seed1 = players.filter((player) => player.seed === 1)
  const seed2 = players.filter((player) => player.seed === 2)
  return {
    fixtureId: fixture.id,
    teamId,
    pairs: [
      { player1Id: seed1[0].id, player2Id: seed2[0].id },
      { player1Id: seed1[1].id, player2Id: seed2[1].id },
      { player1Id: seed1[0].id, player2Id: seed2[1].id },
      { player1Id: seed1[0].id, player2Id: seed1[1].id },
    ],
  }
}

async function saveLineup(session: LocalSession, fixtureId: string, teamId: string): Promise<void> {
  const current = await snapshot(session)
  const fixture = current.fixtures.find((candidate) => candidate.id === fixtureId)
  if (!fixture) throw new Error('Fixture is missing')
  await callMutation('save_lineup', session, fixture.version, lineupPayload(current, fixture, teamId))
}

async function confirmLineup(session: LocalSession, fixtureId: string, teamId: string): Promise<void> {
  const fixture = (await snapshot(session)).fixtures.find((candidate) => candidate.id === fixtureId)
  if (!fixture) throw new Error('Fixture vanished')
  await callMutation('confirm_lineup', session, fixture.version, { fixtureId, teamId })
}

async function saveAndConfirmLineup(session: LocalSession, fixtureId: string, teamId: string): Promise<void> {
  await saveLineup(session, fixtureId, teamId)
  await confirmLineup(session, fixtureId, teamId)
}

async function confirmAllLineups(session: LocalSession, stages: Fixture['stage'][]): Promise<void> {
  const fixtures = (await snapshot(session)).fixtures.filter((fixture) => stages.includes(fixture.stage))
  for (const fixture of fixtures) {
    if (!fixture.team_a_id || !fixture.team_b_id) throw new Error('Fixture participants are missing')
    await saveAndConfirmLineup(session, fixture.id, fixture.team_a_id)
    await saveAndConfirmLineup(session, fixture.id, fixture.team_b_id)
  }
}

async function startQualifying(session: LocalSession): Promise<Snapshot> {
  await createRoster(session)
  await confirmAllLineups(session, ['qualifying'])
  const current = await snapshot(session)
  await callMutation('start_qualifying', session, current.tournament.version, {})
  return snapshot(session)
}

function stageFixtures(current: Snapshot, stage: Fixture['stage']): Fixture[] {
  return current.fixtures.filter((fixture) => fixture.stage === stage)
}

function fixtureMatches(current: Snapshot, fixtureId: string): Match[] {
  return current.matches
    .filter((match) => match.fixture_id === fixtureId)
    .sort((first, second) => first.match_number - second.match_number)
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

  it('keeps qualifying lineups private until all twelve are confirmed', async () => {
    const organizer = await signInAnonymously()
    const referee = await signInAnonymously()
    await elevate(organizer)
    await elevate(referee, '1357')
    const created = await createRoster(organizer)
    const fixture = stageFixtures(created, 'qualifying')[0]
    if (!fixture.team_a_id || !fixture.team_b_id) throw new Error('Fixture has no teams')

    await saveLineup(organizer, fixture.id, fixture.team_a_id)
    expect((await snapshot(organizer)).lineups).toHaveLength(1)
    expect((await snapshot(referee)).lineups).toEqual([])
    expect((await snapshot()).lineups).toEqual([])

    await confirmLineup(organizer, fixture.id, fixture.team_a_id)
    await saveAndConfirmLineup(organizer, fixture.id, fixture.team_b_id)
    expect((await snapshot(referee)).lineups).toEqual([])
    expect((await snapshot()).lineups).toEqual([])

    const remaining = stageFixtures(await snapshot(organizer), 'qualifying').filter((candidate) => candidate.id !== fixture.id)
    for (const other of remaining) {
      if (!other.team_a_id || !other.team_b_id) throw new Error('Fixture has no teams')
      await saveAndConfirmLineup(organizer, other.id, other.team_a_id)
      await saveAndConfirmLineup(organizer, other.id, other.team_b_id)
    }
    expect((await snapshot(referee)).lineups).toHaveLength(12)
    expect((await snapshot()).lineups).toHaveLength(12)
  })

  it('rejects invalid declared pairs and locks lineups after play starts', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)
    const created = await createRoster(organizer)
    const fixture = stageFixtures(created, 'qualifying')[0]
    if (!fixture.team_a_id) throw new Error('Fixture has no team A')

    const repeated = lineupPayload(created, fixture, fixture.team_a_id)
    repeated.pairs[1] = repeated.pairs[0]
    expect((await rpc('save_lineup', mutation(fixture.version, repeated), organizer)).ok).toBe(false)

    const sameSeed = lineupPayload(created, fixture, fixture.team_a_id)
    sameSeed.pairs[0] = sameSeed.pairs[3]
    expect((await rpc('save_lineup', mutation(fixture.version, sameSeed), organizer)).ok).toBe(false)

    const ready = await startQualifying(organizer)
    const qualifyingMatch = fixtureMatches(ready, fixture.id)[0]
    if (!qualifyingMatch) throw new Error('Qualifying match is missing')
    const assigned = await assignCourt(organizer, qualifyingMatch.id, 1)
    await callMutation('start_match', organizer, assigned.version, { matchId: assigned.id })
    const startedFixture = (await snapshot(organizer)).fixtures.find((candidate) => candidate.id === fixture.id)
    expect((await rpc('reopen_lineups', mutation(startedFixture?.version ?? -1, {
      fixtureId: fixture.id,
    }), organizer)).ok).toBe(false)
  })

  it('enforces stage scoring rules and completes a one-game match', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)
    expect(runSql("select private.is_game_won(21, 20, 'qualifying');")).toBe('f')
    expect(runSql("select private.is_game_won(21, 19, 'qualifying');")).toBe('t')
    expect(runSql("select private.is_game_won(30, 29, 'third-place');")).toBe('t')
    expect(runSql("select private.is_game_won(11, 9, 'qualification-playoff');")).toBe('t')
    expect(runSql("select private.is_game_won(14, 13, 'qualification-playoff');")).toBe('f')
    expect(runSql("select private.is_game_won(15, 14, 'qualification-playoff');")).toBe('t')
    expect(runSql("select private.is_game_won(30, 28, 'final');")).toBe('t')

    const qualifying = await startQualifying(organizer)
    const assigned = await assignCourt(organizer, qualifying.matches[0].id, 1)
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
    const first = await assignCourt(organizer, qualifying.matches[0].id, 1)
    await callMutation('start_match', organizer, first.version, { matchId: first.id })

    // A fixture sharing no team, so only the occupied court can block the start.
    const firstFixture = qualifying.fixtures.find((fixture) => fixture.id === first.fixture_id)
    const busyTeams = [firstFixture?.team_a_id, firstFixture?.team_b_id]
    const freeFixture = stageFixtures(qualifying, 'qualifying').find((fixture) =>
      !busyTeams.includes(fixture.team_a_id) && !busyTeams.includes(fixture.team_b_id))
    const other = freeFixture ? fixtureMatches(qualifying, freeFixture.id)[0] : undefined
    if (!other) throw new Error('Second match is missing')
    const assignedOther = await assignCourt(organizer, other.id, 1)
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
    expect((await rpc('save_lineup', mutation(final.version, lineupPayload(progressed, final, final.team_a_id)), organizer)).ok)
      .toBe(false)

    await callMutation('confirm_finalists', organizer, progressed.tournament.version, {})
    expect((await snapshot(organizer)).tournament).toMatchObject({ stage: 'knockouts' })
    await confirmAllLineups(organizer, ['third-place', 'final'])
    progressed = await snapshot(organizer)
    const finalMatches = fixtureMatches(progressed, final.id)
    expect(finalMatches).toHaveLength(3)

    const earlyFinal = await assignCourt(organizer, finalMatches[0].id, 1)
    expect((await rpc('start_match', mutation(earlyFinal.version, { matchId: earlyFinal.id }), organizer)).ok).toBe(false)

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
