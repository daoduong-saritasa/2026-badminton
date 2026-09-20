import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { requireLocalSupabase, resetLocalDatabase, runSql } from './local-supabase.ts'

interface SeededRoundRobin {
  playoffLeader: string
  tiedDrawTeam: string
  otherDrawTeam: string
  tournamentId: string
  tournamentVersion: number
  playoffMatchToCorrect: string
  finalFixtureId: string
}

function seedRoundRobinWithResidualDraw(): SeededRoundRobin {
  const tournamentId = crypto.randomUUID()
  const [teamA, teamB, teamC, teamD] = Array.from({ length: 4 }, () => crypto.randomUUID())
  const [ab, ac, ad, bc, bd, cd] = Array.from({ length: 6 }, () => crypto.randomUUID())
  const [playoffAB, playoffBC, playoffCA] = Array.from({ length: 3 }, () => crypto.randomUUID())
  const [playoffMatchAB, playoffMatchBC, playoffMatchCA] = Array.from(
    { length: 3 },
    () => crypto.randomUUID(),
  )
  const finalFixtureId = crypto.randomUUID()
  const thirdPlaceFixtureId = crypto.randomUUID()

  runSql(`
    insert into public.tournament (id, name, stage)
    values ('${tournamentId}', 'Round-robin phase 1', 'groups');
    insert into public.teams (id, tournament_id, name) values
      ('${teamA}', '${tournamentId}', 'A'),
      ('${teamB}', '${tournamentId}', 'B'),
      ('${teamC}', '${tournamentId}', 'C'),
      ('${teamD}', '${tournamentId}', 'D');
    insert into public.team_fixtures (
      id, tournament_id, stage, team_a_id, team_b_id
    ) values
      ('${ab}', '${tournamentId}', 'qualifying', '${teamA}', '${teamB}'),
      ('${ac}', '${tournamentId}', 'qualifying', '${teamA}', '${teamC}'),
      ('${ad}', '${tournamentId}', 'qualifying', '${teamA}', '${teamD}'),
      ('${bc}', '${tournamentId}', 'qualifying', '${teamB}', '${teamC}'),
      ('${bd}', '${tournamentId}', 'qualifying', '${teamB}', '${teamD}'),
      ('${cd}', '${tournamentId}', 'qualifying', '${teamC}', '${teamD}'),
      ('${playoffAB}', '${tournamentId}', 'qualification-playoff', '${teamA}', '${teamB}'),
      ('${playoffBC}', '${tournamentId}', 'qualification-playoff', '${teamB}', '${teamC}'),
      ('${playoffCA}', '${tournamentId}', 'qualification-playoff', '${teamC}', '${teamA}'),
      ('${thirdPlaceFixtureId}', '${tournamentId}', 'third-place', null, null),
      ('${finalFixtureId}', '${tournamentId}', 'final', null, null);
    insert into public.matches (
      fixture_id, match_number, state, result_kind, winner_side
    ) values
      ('${ab}', 1, 'completed', 'walkover', 'a'),
      ('${ab}', 2, 'completed', 'walkover', 'b'),
      ('${ac}', 1, 'completed', 'walkover', 'a'),
      ('${ac}', 2, 'completed', 'walkover', 'b'),
      ('${ad}', 1, 'completed', 'walkover', 'a'),
      ('${ad}', 2, 'completed', 'walkover', 'a'),
      ('${bc}', 1, 'completed', 'walkover', 'a'),
      ('${bc}', 2, 'completed', 'walkover', 'b'),
      ('${bd}', 1, 'completed', 'walkover', 'a'),
      ('${bd}', 2, 'completed', 'walkover', 'a'),
      ('${cd}', 1, 'completed', 'walkover', 'a'),
      ('${cd}', 2, 'completed', 'walkover', 'a'),
      ('${playoffMatchAB}', '${playoffAB}', 1, 'completed', 'played', 'a'),
      ('${playoffMatchBC}', '${playoffBC}', 1, 'completed', 'played', 'a'),
      ('${playoffMatchCA}', '${playoffCA}', 1, 'completed', 'played', 'a');
    insert into public.match_games (
      match_id, game_number, score_a, score_b, confirmed_at
    ) values
      ('${playoffMatchAB}', 1, 12, 10, clock_timestamp()),
      ('${playoffMatchBC}', 1, 11, 9, clock_timestamp()),
      ('${playoffMatchCA}', 1, 12, 10, clock_timestamp());
  `)

  return {
    playoffLeader: teamA,
    tiedDrawTeam: teamB,
    otherDrawTeam: teamC,
    tournamentId,
    tournamentVersion: 0,
    playoffMatchToCorrect: playoffMatchAB,
    finalFixtureId,
  }
}

describe('round-robin phase 1 SQL boundaries', () => {
  beforeAll(async () => {
    await requireLocalSupabase()
  })

  beforeEach(() => {
    resetLocalDatabase()
  })

  it('keeps the automatic playoff qualifier and draws only the remaining slot', () => {
    const seeded = seedRoundRobinWithResidualDraw()
    runSql(`
      select private.team_record_draw(
        '${crypto.randomUUID()}',
        ${seeded.tournamentVersion},
        jsonb_build_object('advancingTeamIds', jsonb_build_array('${seeded.tiedDrawTeam}'))
      );
    `)

    expect(runSql(`
      select qualification_draw_winner_ids @> array[
        '${seeded.playoffLeader}'::uuid,
        '${seeded.tiedDrawTeam}'::uuid
      ] and cardinality(qualification_draw_winner_ids) = 2
      from public.tournament where id = '${seeded.tournamentId}';
    `)).toBe('t')
  })

  it('rejects draw changes after placement play starts', () => {
    const seeded = seedRoundRobinWithResidualDraw()
    runSql(`
      insert into public.matches (fixture_id, match_number, state)
      values ('${seeded.finalFixtureId}', 1, 'playing');
    `)

    expect(() => runSql(`
      select private.team_record_draw(
        '${crypto.randomUUID()}',
        ${seeded.tournamentVersion},
        jsonb_build_object('advancingTeamIds', jsonb_build_array('${seeded.tiedDrawTeam}'))
      );
    `)).toThrow('Draws are locked after placement play starts')
  })

  it('invalidates a stored draw when a score-only correction changes the cutoff', () => {
    const seeded = seedRoundRobinWithResidualDraw()
    runSql(`
      update public.tournament
      set qualification_draw_winner_ids = array[
        '${seeded.playoffLeader}'::uuid,
        '${seeded.tiedDrawTeam}'::uuid
      ];
      select private.populate_placement_fixtures();
      select private.apply_team_correction(
        '${seeded.playoffMatchToCorrect}',
        'a',
        '[{"a":11,"b":9}]'::jsonb
      );
    `)

    expect(runSql(`
      select qualification_draw_winner_ids is null
      from public.tournament where id = '${seeded.tournamentId}';
    `)).toBe('t')
    expect(runSql(`
      select team_a_id = '${seeded.playoffLeader}'::uuid
          or team_b_id = '${seeded.playoffLeader}'::uuid
      from public.team_fixtures where id = '${seeded.finalFixtureId}';
    `)).toBe('t')
  })

  it('preserves placement lineups when a qualifying correction cannot change participants', () => {
    const tournamentId = crypto.randomUUID()
    const [teamA, teamB] = [crypto.randomUUID(), crypto.randomUUID()]
    const qualifyingFixture = crypto.randomUUID()
    const qualifyingMatch = crypto.randomUUID()
    const finalFixture = crypto.randomUUID()
    const [playerA, playerB] = [crypto.randomUUID(), crypto.randomUUID()]
    runSql(`
      insert into public.tournament (id, name, stage, finalists_confirmed_at)
      values ('${tournamentId}', 'Preserve lineups', 'knockouts', clock_timestamp());
      insert into public.teams (id, tournament_id, name) values
        ('${teamA}', '${tournamentId}', 'A'),
        ('${teamB}', '${tournamentId}', 'B');
      insert into public.players (id, team_id, name, seed) values
        ('${playerA}', '${teamA}', 'A1', 1),
        ('${playerB}', '${teamA}', 'A2', 2);
      insert into public.team_fixtures (
        id, tournament_id, stage, team_a_id, team_b_id
      ) values
        ('${qualifyingFixture}', '${tournamentId}', 'qualifying', '${teamA}', '${teamB}'),
        ('${finalFixture}', '${tournamentId}', 'final', '${teamA}', '${teamB}');
      insert into public.matches (
        id, fixture_id, match_number, state, result_kind, winner_side
      ) values (
        '${qualifyingMatch}', '${qualifyingFixture}', 1, 'completed', 'played', 'a'
      );
      insert into public.match_games (
        match_id, game_number, score_a, score_b, confirmed_at
      ) values ('${qualifyingMatch}', 1, 21, 10, clock_timestamp());
      insert into private.lineups (
        fixture_id, team_id, match_number, player_1_id, player_2_id, confirmed_at
      ) values (
        '${finalFixture}', '${teamA}', 1, '${playerA}', '${playerB}', clock_timestamp()
      );
      select private.apply_team_correction(
        '${qualifyingMatch}', 'a', '[{"a":21,"b":11}]'::jsonb
      );
    `)

    expect(runSql(`
      select count(*) from private.lineups where fixture_id = '${finalFixture}';
    `)).toBe('1')
    expect(runSql(`
      select finalists_confirmed_at is not null
      from public.tournament where id = '${tournamentId}';
    `)).toBe('t')
  })
})
