import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  elevate,
  mutation,
  requireLocalSupabase,
  resetLocalDatabase,
  rpc,
  runSql,
  signInAnonymously,
} from './local-supabase.ts'

interface SeededFixture {
  deciderId: string
  fixtureId: string
  matchOneId: string
  matchTwoId: string
  tournamentId: string
}

interface Impact {
  after: unknown
  before: unknown
  blockedReason: string | null
  tournamentVersion: number
}

function seedFixture(options: {
  deciderState?: 'unstarted' | 'playing'
  secondWinner?: 'a' | 'b'
} = {}): SeededFixture {
  const tournamentId = crypto.randomUUID()
  const teamA = crypto.randomUUID()
  const teamB = crypto.randomUUID()
  const fixtureId = crypto.randomUUID()
  const matchOneId = crypto.randomUUID()
  const matchTwoId = crypto.randomUUID()
  const deciderId = crypto.randomUUID()
  const players = Array.from({ length: 8 }, () => crypto.randomUUID())
  const secondWinner = options.secondWinner ?? 'b'
  const deciderState = options.deciderState ?? 'unstarted'

  runSql(`
    insert into public.tournament (id, name, stage) values ('${tournamentId}', 'Impact integration', 'groups');
    insert into public.teams (id, tournament_id, name, group_code) values
      ('${teamA}', '${tournamentId}', 'Team A', 'A'),
      ('${teamB}', '${tournamentId}', 'Team B', 'A');
    insert into public.players (id, team_id, name, seed) values
      ('${players[0]}', '${teamA}', 'A1', 1), ('${players[1]}', '${teamA}', 'A2', 1),
      ('${players[2]}', '${teamA}', 'A3', 2), ('${players[3]}', '${teamA}', 'A4', 2),
      ('${players[4]}', '${teamB}', 'B1', 1), ('${players[5]}', '${teamB}', 'B2', 1),
      ('${players[6]}', '${teamB}', 'B3', 2), ('${players[7]}', '${teamB}', 'B4', 2);
    insert into public.team_fixtures (id, tournament_id, stage, group_code, team_a_id, team_b_id)
    values ('${fixtureId}', '${tournamentId}', 'group', 'A', '${teamA}', '${teamB}');
    insert into public.matches (
      id, fixture_id, match_number,
      pair_a_seed1_player_id, pair_a_seed2_player_id,
      pair_b_seed1_player_id, pair_b_seed2_player_id,
      state, result_kind, winner_side
    ) values
      ('${matchOneId}', '${fixtureId}', 1, '${players[0]}', '${players[2]}', '${players[4]}', '${players[6]}', 'completed', 'walkover', 'a'),
      ('${matchTwoId}', '${fixtureId}', 2, '${players[1]}', '${players[3]}', '${players[5]}', '${players[7]}', 'completed', 'walkover', '${secondWinner}'),
      ('${deciderId}', '${fixtureId}', 3, '${players[0]}', '${players[3]}', '${players[4]}', '${players[7]}', '${deciderState}', null, null);
  `)
  return { deciderId, fixtureId, matchOneId, matchTwoId, tournamentId }
}

function correctionPayload(matchId: string, winnerSide: 'a' | 'b', previewVersion = 0) {
  return {
    matchId,
    winnerSide,
    games: winnerSide === 'a'
      ? [{ a: 15, b: 10 }, { a: 15, b: 12 }]
      : [{ a: 10, b: 15 }, { a: 12, b: 15 }],
    previewTournamentVersion: previewVersion,
  }
}

describe('team result impacts', () => {
  beforeAll(async () => {
    await requireLocalSupabase()
  })

  beforeEach(() => {
    resetLocalDatabase()
  })

  it('projects a correction without persisting it and accepts the reviewed version', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)
    const seeded = seedFixture()
    const payload = correctionPayload(seeded.matchTwoId, 'a')

    const previewResponse = await rpc(
      'preview_result_correction',
      mutation(0, payload),
      organizer,
    )
    expect(previewResponse.ok).toBe(true)
    const preview = (await previewResponse.json()) as Impact
    expect(preview.blockedReason).toBeNull()
    expect(preview.before).not.toEqual(preview.after)
    expect(runSql(`select winner_side from public.matches where id = '${seeded.matchTwoId}';`)).toBe('b')

    const correction = await rpc(
      'correct_result',
      mutation(0, correctionPayload(seeded.matchTwoId, 'a', preview.tournamentVersion)),
      organizer,
    )
    expect(correction.ok).toBe(true)
    expect(runSql(`select winner_side from public.matches where id = '${seeded.matchTwoId}';`)).toBe('a')
  })

  it('blocks a correction that would invalidate a started decider', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)
    const seeded = seedFixture({ deciderState: 'playing' })
    const preview = await rpc(
      'preview_result_correction',
      mutation(0, correctionPayload(seeded.matchTwoId, 'a')),
      organizer,
    )
    expect(preview.ok).toBe(true)
    expect(await preview.json()).toMatchObject({ blockedReason: 'decider-started', after: null })
  })

  it('reopens the decider and removes stale placements when correction restores 1-1', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)
    const seeded = seedFixture({ secondWinner: 'a' })
    const placementFixture = crypto.randomUUID()
    runSql(`
      update public.matches set state = 'unnecessary' where id = '${seeded.deciderId}';
      insert into public.team_fixtures (id, tournament_id, stage)
      values ('${placementFixture}', '${seeded.tournamentId}', 'final');
      update public.tournament set stage = 'knockouts' where singleton;
    `)
    const previewResponse = await rpc(
      'preview_result_correction',
      mutation(0, correctionPayload(seeded.matchTwoId, 'b')),
      organizer,
    )
    const preview = (await previewResponse.json()) as Impact
    expect(preview.blockedReason).toBeNull()
    const correction = await rpc(
      'correct_result',
      mutation(0, correctionPayload(seeded.matchTwoId, 'b', preview.tournamentVersion)),
      organizer,
    )
    expect(correction.ok).toBe(true)
    expect(runSql(`select state from public.matches where id = '${seeded.deciderId}';`)).toBe('unstarted')
    expect(runSql("select count(*) from public.team_fixtures where stage <> 'group';")).toBe('0')
  })

  it('blocks changed advancement after a placement match starts', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)
    const seeded = seedFixture({ secondWinner: 'a' })
    const placementFixture = crypto.randomUUID()
    const placementMatch = crypto.randomUUID()
    const otherTeam = crypto.randomUUID()
    runSql(`
      insert into public.teams (id, tournament_id, name, group_code)
      values ('${otherTeam}', '${seeded.tournamentId}', 'Other team', 'B');
      insert into public.team_fixtures (id, tournament_id, stage, team_a_id, team_b_id)
      select '${placementFixture}', '${seeded.tournamentId}', 'final', team_a_id, '${otherTeam}'
      from public.team_fixtures where id = '${seeded.fixtureId}';
      insert into public.matches (id, fixture_id, match_number, state)
      values ('${placementMatch}', '${placementFixture}', 1, 'playing');
    `)

    const preview = await rpc(
      'preview_result_correction',
      mutation(0, correctionPayload(seeded.matchTwoId, 'b')),
      organizer,
    )
    expect(preview.ok).toBe(true)
    expect(await preview.json()).toMatchObject({ blockedReason: 'placement-started' })
  })

  it('blocks every correction after tournament completion and rejects stale previews', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)
    const seeded = seedFixture()
    runSql("update public.tournament set stage = 'completed' where singleton;")
    const blocked = await rpc(
      'preview_result_correction',
      mutation(0, correctionPayload(seeded.matchTwoId, 'a')),
      organizer,
    )
    expect(await blocked.json()).toMatchObject({ blockedReason: 'tournament-completed' })

    runSql("update public.tournament set stage = 'groups', result_revision = 2 where singleton;")
    const stale = await rpc(
      'correct_result',
      mutation(0, correctionPayload(seeded.matchTwoId, 'a', 0)),
      organizer,
    )
    expect(stale.ok).toBe(false)
  })
})
