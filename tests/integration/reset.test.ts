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

interface Snapshot {
  fixtures: Array<{ id: string; stage: string }>
  games: unknown[]
  matches: Array<{
    id: string
    court: number | null
    pair_a_player_1_id: string | null
    pair_b_player_1_id: string | null
    state: string
    version: number
  }>
  players: Array<{ id: string }>
  teams: Array<{ id: string }>
  tournament: { id: string; name: string; stage: string; version: number }
}

interface TournamentState {
  resetGeneration: number
  snapshot: Snapshot | null
}

function rosterPayload(): Record<string, unknown> {
  return {
    tournamentName: 'Reset integration',
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
  const response = await rpc('get_tournament_snapshot', {}, session)
  expect(response.ok).toBe(true)
  return (await response.json()) as TournamentState
}

async function createTournament(session: LocalSession): Promise<TournamentState> {
  const response = await rpc('save_roster', mutation(0, rosterPayload()), session)
  expect(response.ok).toBe(true)
  return state(session)
}

function resetBody(
  target: TournamentState,
  mode: 'progress' | 'all',
  requestId = crypto.randomUUID(),
): Record<string, unknown> {
  if (!target.snapshot) throw new Error('Reset target is empty')
  return {
    p_request_id: requestId,
    p_expected_generation: target.resetGeneration,
    p_expected_tournament_id: target.snapshot.tournament.id,
    p_expected_version: target.snapshot.tournament.version,
    p_mode: mode,
    p_confirmation_name: target.snapshot.tournament.name,
  }
}

describe('team tournament maintenance reset', () => {
  beforeAll(async () => {
    await requireLocalSupabase()
  })

  beforeEach(() => {
    resetLocalDatabase()
  })

  it('keeps reset control service-only and rejects stale targets atomically', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)
    const target = await createTournament(organizer)
    const body = resetBody(target, 'progress')

    expect((await anonymousRpc('set_reset_enabled', { p_enabled: true })).ok).toBe(false)
    expect((await rpc('set_reset_enabled', { p_enabled: true }, organizer)).ok).toBe(false)
    expect((await rpc('reset_tournament', body, organizer)).ok).toBe(false)
    expect((await rpc('set_reset_enabled', { p_enabled: true })).ok).toBe(true)
    expect((await rpc('reset_tournament', {
      ...body,
      p_expected_version: (body.p_expected_version as number) + 1,
    })).ok).toBe(false)
    expect(await state(organizer)).toEqual(target)
  })

  it('keeps fixtures, match identities, and courts on progress reset while clearing play and pairs', async () => {
    const organizer = await signInAnonymously()
    const referee = await signInAnonymously()
    await elevate(organizer)
    await elevate(referee, '1357')
    const created = await createTournament(organizer)
    if (!created.snapshot) throw new Error('Tournament is missing')
    const fixtureId = created.snapshot.fixtures.find((fixture) => fixture.stage === 'qualifying')?.id
    if (!fixtureId) throw new Error('Qualifying fixture is missing')
    const players = created.snapshot.players.slice(0, 8).map((player) => player.id)
    const [teamA, teamB, teamC] = created.snapshot.teams.map((team) => team.id)
    const matchId = crypto.randomUUID()
    const finalMatchId = crypto.randomUUID()
    const roundId = crypto.randomUUID()
    const playoffFixtureId = crypto.randomUUID()
    const playoffMatchId = crypto.randomUUID()
    const finalId = created.snapshot.fixtures.find((fixture) => fixture.stage === 'final')?.id
    if (!finalId) throw new Error('Final fixture is missing')
    runSql(`
      insert into public.matches (
        id, fixture_id, match_number,
        pair_a_player_1_id, pair_a_player_2_id,
        pair_b_player_1_id, pair_b_player_2_id,
        court, state
      ) values (
        '${matchId}', '${fixtureId}', 1,
        '${players[0]}', '${players[2]}', '${players[4]}', '${players[6]}',
        1, 'playing'
      );
      insert into public.match_games (match_id, game_number, score_a, score_b)
      values ('${matchId}', 1, 4, 3);
      insert into private.match_ownership (match_id, session_id)
      values ('${matchId}', '${referee.sessionId}');
      insert into private.scoring_handovers (match_id, from_session_id, to_session_id)
      values ('${matchId}', '${organizer.sessionId}', '${referee.sessionId}');
      update public.team_fixtures set team_a_id = '${teamA}', team_b_id = '${teamB}'
      where id = '${finalId}';
      insert into public.matches (id, fixture_id, match_number, pair_a_player_1_id, pair_a_player_2_id, court)
      values ('${finalMatchId}', '${finalId}', 1, '${players[0]}', '${players[2]}', 2);
      insert into public.qualification_playoff_rounds (
        id, tournament_id, round_number, team_ids, fixed_finalist_ids, available_places
      ) values ('${roundId}', '${created.snapshot.tournament.id}', 1,
        array['${[teamB, teamC].sort().join("','")}']::uuid[], array['${teamA}']::uuid[], 1);
      insert into public.team_fixtures (id, tournament_id, stage, team_a_id, team_b_id, playoff_round_id)
      values ('${playoffFixtureId}', '${created.snapshot.tournament.id}', 'qualification-playoff',
        '${teamB}', '${teamC}', '${roundId}');
      insert into public.matches (id, fixture_id, match_number, state, result_kind, winner_side, court)
      values ('${playoffMatchId}', '${playoffFixtureId}', 1, 'completed', 'walkover', 'a', 2);
      update public.tournament
      set stage = 'knockouts', finalists_confirmed_at = clock_timestamp(),
          current_playoff_round_id = '${roundId}', version = version + 1
      where singleton;
    `)

    const before = await state(organizer)
    expect((await rpc('set_reset_enabled', { p_enabled: true })).ok).toBe(true)
    expect((await rpc('reset_tournament', resetBody(before, 'progress'))).ok).toBe(true)
    const after = await state(organizer)
    expect(after.resetGeneration).toBe(1)
    expect(after.snapshot?.tournament).toMatchObject({ name: 'Reset integration', stage: 'setup' })
    expect(after.snapshot?.teams).toEqual(before.snapshot?.teams)
    expect(after.snapshot?.players).toEqual(before.snapshot?.players)
    expect(after.snapshot?.fixtures.map((fixture) => fixture.id).sort())
      .toEqual(before.snapshot?.fixtures.map((fixture) => fixture.id).sort())
    expect(after.snapshot?.games).toEqual([])
    expect(after.snapshot?.matches.map(({ id, court, state: matchState, pair_a_player_1_id, pair_b_player_1_id }) => ({
      id, court, state: matchState, pair_a_player_1_id, pair_b_player_1_id,
    })).sort((left, right) => left.id.localeCompare(right.id))).toEqual([
      { id: matchId, court: 1, state: 'unstarted', pair_a_player_1_id: null, pair_b_player_1_id: null },
      { id: finalMatchId, court: 2, state: 'unstarted', pair_a_player_1_id: null, pair_b_player_1_id: null },
      { id: playoffMatchId, court: 2, state: 'unstarted', pair_a_player_1_id: null, pair_b_player_1_id: null },
    ].sort((left, right) => left.id.localeCompare(right.id)))
    expect(runSql(`select count(*) from public.team_fixtures where stage in ('third-place', 'final') and team_a_id is not null;`)).toBe('0')
    // Historical rounds are gone; their fixture stays as an unassigned slot for the next round.
    expect(runSql('select count(*) from public.qualification_playoff_rounds;')).toBe('0')
    expect(runSql(`
      select team_a_id is null and team_b_id is null and playoff_round_id is null
      from public.team_fixtures where id = '${playoffFixtureId}';
    `)).toBe('t')
    expect(runSql('select finalists_confirmed_at is null and current_playoff_round_id is null from public.tournament;')).toBe('t')
    expect(runSql('select count(*) from private.match_ownership;')).toBe('0')
    expect(runSql('select count(*) from private.scoring_handovers;')).toBe('0')
    expect((await rpc('get_staff_access', {}, organizer)).ok).toBe(true)

    // Restarting qualifying reuses the retained matches rather than creating new ones.
    const restarted = await rpc('start_qualifying', mutation(after.snapshot?.tournament.version ?? -1, {}, crypto.randomUUID(), 1), organizer)
    expect(restarted.ok).toBe(true)
    expect(runSql(`select count(*) from public.matches where id = '${matchId}' and court = 1;`)).toBe('1')
    expect(runSql(`select count(*) from public.matches as match join public.team_fixtures as fixture on fixture.id = match.fixture_id where fixture.stage = 'qualifying';`)).toBe('12')
  })

  it('clears the new model on all reset, preserves audit/access, and replays safely', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)
    const before = await createTournament(organizer)
    const requestId = crypto.randomUUID()
    const body = resetBody(before, 'all', requestId)
    const staffAuditCount = runSql("select count(*) from private.mutation_log where actor_kind = 'staff';")

    expect((await rpc('set_reset_enabled', { p_enabled: true })).ok).toBe(true)
    const first = await rpc('reset_tournament', body)
    expect(first.ok).toBe(true)
    const receipt = await first.json()
    const replay = await rpc('reset_tournament', body)
    expect(replay.ok).toBe(true)
    expect(await replay.json()).toEqual(receipt)
    expect(await state(organizer)).toEqual({ resetGeneration: 1, snapshot: null })
    expect((await rpc('get_staff_access', {}, organizer)).ok).toBe(true)
    expect(runSql("select count(*) from private.mutation_log where actor_kind = 'staff';")).toBe(staffAuditCount)
    expect(runSql(`select maintenance_mode from private.mutation_log where request_id = '${requestId}'::uuid;`)).toBe('all')
    expect((await rpc('save_roster', mutation(0, rosterPayload()), organizer)).ok).toBe(false)
    expect((await rpc('save_roster', mutation(0, rosterPayload(), crypto.randomUUID(), 1), organizer)).ok).toBe(true)
  })
})
