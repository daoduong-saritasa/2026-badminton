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
  fixtures: Array<{ id: string }>
  games: unknown[]
  matches: Array<{ id: string; state: string; version: number }>
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
      group: teamIndex < 2 ? 'A' : 'B',
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

  it('clears games, ownership, handovers, and placement fixtures on progress reset', async () => {
    const organizer = await signInAnonymously()
    const referee = await signInAnonymously()
    await elevate(organizer)
    await elevate(referee, '1357')
    const created = await createTournament(organizer)
    if (!created.snapshot) throw new Error('Tournament is missing')
    const fixtureId = created.snapshot.fixtures[0].id
    const players = created.snapshot.players.slice(0, 8).map((player) => player.id)
    const matchId = crypto.randomUUID()
    const placementId = crypto.randomUUID()
    runSql(`
      insert into public.matches (
        id, fixture_id, match_number,
        pair_a_seed1_player_id, pair_a_seed2_player_id,
        pair_b_seed1_player_id, pair_b_seed2_player_id,
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
      insert into public.team_fixtures (id, tournament_id, stage)
      values ('${placementId}', '${created.snapshot.tournament.id}', 'final');
      update public.tournament set stage = 'knockouts', version = version + 1 where singleton;
    `)

    const before = await state(organizer)
    expect((await rpc('set_reset_enabled', { p_enabled: true })).ok).toBe(true)
    expect((await rpc('reset_tournament', resetBody(before, 'progress'))).ok).toBe(true)
    const after = await state(organizer)
    expect(after.resetGeneration).toBe(1)
    expect(after.snapshot?.teams).toHaveLength(4)
    expect(after.snapshot?.players).toHaveLength(16)
    expect(after.snapshot?.fixtures).toHaveLength(2)
    expect(after.snapshot?.games).toEqual([])
    expect(after.snapshot?.matches).toEqual([
      expect.objectContaining({ id: matchId, state: 'unstarted' }),
    ])
    expect(runSql('select count(*) from private.match_ownership;')).toBe('0')
    expect(runSql('select count(*) from private.scoring_handovers;')).toBe('0')
    expect((await rpc('get_staff_access', {}, organizer)).ok).toBe(true)
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
