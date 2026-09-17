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
  group_code: 'A' | 'B'
  id: string
  name: string
}

interface Player {
  id: string
  seed: 1 | 2
  team_id: string
}

interface Fixture {
  group_code: 'A' | 'B' | null
  id: string
  stage: 'group' | 'third-place' | 'final'
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
      group: teamIndex < 2 ? 'A' : 'B',
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

function lineupPayload(current: Snapshot, fixture: Fixture, teamId: string) {
  const players = current.players.filter((player) => player.team_id === teamId)
  const seed1 = players.filter((player) => player.seed === 1)
  const seed2 = players.filter((player) => player.seed === 2)
  return {
    fixtureId: fixture.id,
    teamId,
    pairs: [
      { seed1PlayerId: seed1[0].id, seed2PlayerId: seed2[0].id },
      { seed1PlayerId: seed1[1].id, seed2PlayerId: seed2[1].id },
      { seed1PlayerId: seed1[0].id, seed2PlayerId: seed2[1].id },
    ],
  }
}

async function saveAndConfirmLineup(
  session: LocalSession,
  fixtureId: string,
  teamId: string,
): Promise<void> {
  let current = await snapshot(session)
  let fixture = current.fixtures.find((candidate) => candidate.id === fixtureId)
  if (!fixture) throw new Error('Fixture is missing')
  await callMutation('save_lineup', session, fixture.version, lineupPayload(current, fixture, teamId))
  current = await snapshot(session)
  fixture = current.fixtures.find((candidate) => candidate.id === fixtureId)
  if (!fixture) throw new Error('Fixture vanished')
  await callMutation('confirm_lineup', session, fixture.version, { fixtureId, teamId })
}

async function confirmAllLineups(session: LocalSession, stages: Fixture['stage'][]): Promise<void> {
  const fixtures = (await snapshot(session)).fixtures.filter((fixture) => stages.includes(fixture.stage))
  for (const fixture of fixtures) {
    if (!fixture.team_a_id || !fixture.team_b_id) throw new Error('Fixture participants are missing')
    await saveAndConfirmLineup(session, fixture.id, fixture.team_a_id)
    await saveAndConfirmLineup(session, fixture.id, fixture.team_b_id)
  }
}

async function startGroups(session: LocalSession): Promise<Snapshot> {
  await createRoster(session)
  await confirmAllLineups(session, ['group'])
  const current = await snapshot(session)
  await callMutation('start_group_play', session, current.tournament.version, {})
  return snapshot(session)
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

  it('validates four complete rosters and creates two group fixture shells', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)
    const invalid = rosterPayload()
    ;(invalid.teams as Array<{ players: unknown[] }>)[0].players.pop()
    expect((await rpc('save_roster', mutation(0, invalid), organizer)).ok).toBe(false)

    const created = await createRoster(organizer)
    expect(created.teams).toHaveLength(4)
    expect(created.players).toHaveLength(16)
    expect(created.fixtures.map((fixture) => fixture.group_code).sort()).toEqual(['A', 'B'])
    expect(created.matches).toEqual([])
  })

  it('keeps a draft lineup private until both teams confirm it', async () => {
    const organizer = await signInAnonymously()
    const referee = await signInAnonymously()
    await elevate(organizer)
    await elevate(referee, '1357')
    const created = await createRoster(organizer)
    const fixture = created.fixtures[0]
    if (!fixture.team_a_id || !fixture.team_b_id) throw new Error('Fixture has no teams')

    await callMutation('save_lineup', organizer, fixture.version, lineupPayload(created, fixture, fixture.team_a_id))
    expect((await snapshot(organizer)).lineups).toHaveLength(1)
    expect((await snapshot(referee)).lineups).toEqual([])
    expect((await snapshot()).lineups).toEqual([])

    let current = await snapshot(organizer)
    const updated = current.fixtures.find((candidate) => candidate.id === fixture.id)
    if (!updated) throw new Error('Fixture vanished')
    await callMutation('confirm_lineup', organizer, updated.version, {
      fixtureId: fixture.id,
      teamId: fixture.team_a_id,
    })
    await saveAndConfirmLineup(organizer, fixture.id, fixture.team_b_id)
    current = await snapshot(referee)
    expect(current.lineups).toHaveLength(2)
    expect((await snapshot()).lineups).toHaveLength(2)
  })

  it('rejects repeated opening players and locks both lineups after play starts', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)
    const created = await createRoster(organizer)
    const fixture = created.fixtures[0]
    if (!fixture.team_a_id) throw new Error('Fixture has no team A')
    const invalid = lineupPayload(created, fixture, fixture.team_a_id)
    invalid.pairs[1] = invalid.pairs[0]
    expect((await rpc('save_lineup', mutation(fixture.version, invalid), organizer)).ok).toBe(false)

    await confirmAllLineups(organizer, ['group'])
    const ready = await snapshot(organizer)
    await callMutation('start_group_play', organizer, ready.tournament.version, {})
    const groupMatch = (await snapshot(organizer)).matches.find((match) => match.fixture_id === fixture.id)
    if (!groupMatch) throw new Error('Group match is missing')
    const assigned = await assignCourt(organizer, groupMatch.id, 1)
    await callMutation('start_match', organizer, assigned.version, { matchId: assigned.id })
    const startedFixture = (await snapshot(organizer)).fixtures.find((candidate) => candidate.id === fixture.id)
    expect((await rpc('reopen_lineups', mutation(startedFixture?.version ?? -1, {
      fixtureId: fixture.id,
    }), organizer)).ok).toBe(false)
  })

  it('enforces stage scoring rules and completes a match after two confirmed games', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)
    expect(runSql("select private.is_game_won(15, 14, 'group');")).toBe('f')
    expect(runSql("select private.is_game_won(21, 20, 'group');")).toBe('t')
    expect(runSql("select private.is_game_won(30, 29, 'final');")).toBe('t')

    const groups = await startGroups(organizer)
    const assigned = await assignCourt(organizer, groups.matches[0].id, 1)
    await callMutation('start_match', organizer, assigned.version, { matchId: assigned.id })
    for (let gameNumber = 1; gameNumber <= 2; gameNumber += 1) {
      runSql(`update public.match_games set score_a = 15, score_b = 10 where match_id = '${assigned.id}'::uuid and confirmed_at is null;`)
      const playing = (await snapshot(organizer)).matches.find((match) => match.id === assigned.id)
      if (!playing) throw new Error('Playing match vanished')
      await callMutation('confirm_game', organizer, playing.version, { matchId: playing.id })
    }
    expect((await snapshot(organizer)).matches.find((match) => match.id === assigned.id)).toMatchObject({
      state: 'completed',
      winner_side: 'a',
    })
  })

  it('enables a 1-1 decider and records a 2-0 decider as unnecessary', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)
    const groups = await startGroups(organizer)
    const [firstFixture, secondFixture] = groups.fixtures.filter((fixture) => fixture.stage === 'group')
    const firstMatches = groups.matches.filter((match) => match.fixture_id === firstFixture.id)
    const secondMatches = groups.matches.filter((match) => match.fixture_id === secondFixture.id)
    await walkover(organizer, firstMatches[0].id, 'a')
    await walkover(organizer, firstMatches[1].id, 'b')
    const assigned = await assignCourt(organizer, firstMatches[2].id, 1)
    expect((await rpc('start_match', mutation(assigned.version, { matchId: assigned.id }), organizer)).ok).toBe(true)

    await walkover(organizer, secondMatches[0].id, 'a')
    await walkover(organizer, secondMatches[1].id, 'a')
    expect((await snapshot(organizer)).matches.find((match) => match.id === secondMatches[2].id)?.state).toBe('unnecessary')
  })

  it('blocks occupied courts and rejects writes from a former owner', async () => {
    const organizer = await signInAnonymously()
    const referee = await signInAnonymously()
    await elevate(organizer)
    await elevate(referee, '1357')
    const groups = await startGroups(organizer)
    const first = await assignCourt(organizer, groups.matches[0].id, 1)
    await callMutation('start_match', organizer, first.version, { matchId: first.id })

    const other = groups.matches.find((match) => match.id !== first.id)
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

  it('populates both placement fixtures and completes only after both finish', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)
    const groups = await startGroups(organizer)
    for (const fixture of groups.fixtures.filter((candidate) => candidate.stage === 'group')) {
      const matches = groups.matches.filter((match) => match.fixture_id === fixture.id)
      await walkover(organizer, matches[0].id, 'a')
      await walkover(organizer, matches[1].id, 'a')
    }
    let progressed = await snapshot(organizer)
    expect(progressed.fixtures.filter((fixture) => fixture.stage !== 'group')).toHaveLength(2)
    await confirmAllLineups(organizer, ['third-place', 'final'])
    progressed = await snapshot(organizer)
    const thirdPlace = progressed.fixtures.find((fixture) => fixture.stage === 'third-place')
    const final = progressed.fixtures.find((fixture) => fixture.stage === 'final')
    if (!thirdPlace || !final) throw new Error('Placement fixtures are missing')
    for (const match of progressed.matches.filter((candidate) => candidate.fixture_id === thirdPlace.id).slice(0, 2)) {
      await walkover(organizer, match.id, 'a')
    }
    expect((await snapshot(organizer)).tournament.stage).not.toBe('completed')
    for (const match of (await snapshot(organizer)).matches.filter((candidate) => candidate.fixture_id === final.id).slice(0, 2)) {
      await walkover(organizer, match.id, 'a')
    }
    expect((await snapshot(organizer)).tournament.stage).toBe('completed')
  })
})
