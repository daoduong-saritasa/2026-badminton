import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { requireLocalSupabase, resetLocalDatabase, runSql } from './local-supabase.ts'

interface SeededRoundRobin {
  teamA: string
  teamB: string
  teamC: string
  tournamentId: string
  tournamentVersion: number
  firstRoundId: string
  playoffMatchToCorrect: string
  finalFixtureId: string
}

/**
 * A, B, and C tie on four qualifying wins for both final places. Round 1 of
 * the playoff is a cycle in which A scores the most points, so A qualifies
 * and B and C stay tied for the last place.
 */
function seedThreeTeamRound(): SeededRoundRobin {
  const tournamentId = crypto.randomUUID()
  const [teamA, teamB, teamC, teamD] = Array.from({ length: 4 }, () => crypto.randomUUID())
  const [ab, ac, ad, bc, bd, cd] = Array.from({ length: 6 }, () => crypto.randomUUID())
  const [playoffAB, playoffBC, playoffCA] = Array.from({ length: 3 }, () => crypto.randomUUID())
  const [playoffMatchAB, playoffMatchBC, playoffMatchCA] = Array.from(
    { length: 3 },
    () => crypto.randomUUID(),
  )
  const firstRoundId = crypto.randomUUID()
  const finalFixtureId = crypto.randomUUID()
  const thirdPlaceFixtureId = crypto.randomUUID()
  const sortedTied = [teamA, teamB, teamC].sort()

  runSql(`
    insert into public.tournament (id, name, stage)
    values ('${tournamentId}', 'Round-robin phase 1', 'groups');
    insert into public.teams (id, tournament_id, name) values
      ('${teamA}', '${tournamentId}', 'A'),
      ('${teamB}', '${tournamentId}', 'B'),
      ('${teamC}', '${tournamentId}', 'C'),
      ('${teamD}', '${tournamentId}', 'D');
    insert into public.qualification_playoff_rounds (
      id, tournament_id, round_number, team_ids, fixed_finalist_ids, available_places
    ) values (
      '${firstRoundId}', '${tournamentId}', 1,
      array['${sortedTied.join("','")}']::uuid[], array[]::uuid[], 2
    );
    update public.tournament set current_playoff_round_id = '${firstRoundId}'
    where id = '${tournamentId}';
    insert into public.team_fixtures (
      id, tournament_id, stage, team_a_id, team_b_id, playoff_round_id
    ) values
      ('${ab}', '${tournamentId}', 'qualifying', '${teamA}', '${teamB}', null),
      ('${ac}', '${tournamentId}', 'qualifying', '${teamA}', '${teamC}', null),
      ('${ad}', '${tournamentId}', 'qualifying', '${teamA}', '${teamD}', null),
      ('${bc}', '${tournamentId}', 'qualifying', '${teamB}', '${teamC}', null),
      ('${bd}', '${tournamentId}', 'qualifying', '${teamB}', '${teamD}', null),
      ('${cd}', '${tournamentId}', 'qualifying', '${teamC}', '${teamD}', null),
      ('${playoffAB}', '${tournamentId}', 'qualification-playoff', '${teamA}', '${teamB}', '${firstRoundId}'),
      ('${playoffBC}', '${tournamentId}', 'qualification-playoff', '${teamB}', '${teamC}', '${firstRoundId}'),
      ('${playoffCA}', '${tournamentId}', 'qualification-playoff', '${teamC}', '${teamA}', '${firstRoundId}'),
      ('${thirdPlaceFixtureId}', '${tournamentId}', 'third-place', null, null, null),
      ('${finalFixtureId}', '${tournamentId}', 'final', null, null, null);
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
      ('${cd}', 2, 'completed', 'walkover', 'a');
    insert into public.matches (
      id, fixture_id, match_number, state, result_kind, winner_side
    ) values
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
    teamA,
    teamB,
    teamC,
    tournamentId,
    tournamentVersion: 0,
    firstRoundId,
    playoffMatchToCorrect: playoffMatchAB,
    finalFixtureId,
  }
}

/** Round 2 as "teams|fixed finalists|places", or '' when it does not exist. */
function secondRound(tournamentId: string): string {
  return runSql(`
    select coalesce(string_agg(
      array_to_string(team_ids, ',') || '|' || array_to_string(fixed_finalist_ids, ',') || '|' || available_places,
      ';'
    ), '')
    from public.qualification_playoff_rounds
    where tournament_id = '${tournamentId}' and round_number = 2;
  `)
}

describe('round-robin phase 1 SQL boundaries', () => {
  beforeAll(async () => {
    await requireLocalSupabase()
  })

  beforeEach(() => {
    resetLocalDatabase()
  })

  it('carries an automatic qualifier into a continuation round, created exactly once', () => {
    const seeded = seedThreeTeamRound()
    runSql('select private.populate_placement_fixtures();')
    runSql('select private.populate_placement_fixtures();')

    const tied = [seeded.teamB, seeded.teamC].sort().join(',')
    expect(secondRound(seeded.tournamentId)).toBe(`${tied}|${seeded.teamA}|1`)
    expect(runSql(`
      select count(*) from public.team_fixtures as fixture
      join public.qualification_playoff_rounds as round on round.id = fixture.playoff_round_id
      where round.tournament_id = '${seeded.tournamentId}' and round.round_number = 2;
    `)).toBe('1')
    expect(runSql(`
      select count(*) from public.matches as match
      join public.team_fixtures as fixture on fixture.id = match.fixture_id
      join public.qualification_playoff_rounds as round on round.id = fixture.playoff_round_id
      where round.round_number = 2;
    `)).toBe('1')
    expect(runSql(`
      select current_playoff_round_id = (
        select id from public.qualification_playoff_rounds where round_number = 2
      ) from public.tournament where id = '${seeded.tournamentId}';
    `)).toBe('t')
    // Round 1 results stay on record.
    expect(runSql(`
      select count(*) from public.matches as match
      join public.team_fixtures as fixture on fixture.id = match.fixture_id
      where fixture.playoff_round_id = '${seeded.firstRoundId}' and match.state = 'completed';
    `)).toBe('3')
  })

  it('rejects advancement draws and draw changes after placement play starts', () => {
    const seeded = seedThreeTeamRound()
    expect(() => runSql(`
      select private.team_record_draw(
        '${crypto.randomUUID()}',
        ${seeded.tournamentVersion},
        jsonb_build_object('advancingTeamIds', jsonb_build_array('${seeded.teamB}'))
      );
    `)).toThrow('A four-team draw requires two complete matchups')

    runSql(`
      insert into public.matches (fixture_id, match_number, state)
      values ('${seeded.finalFixtureId}', 1, 'playing');
    `)
    expect(() => runSql(`
      select private.team_record_draw(
        '${crypto.randomUUID()}',
        ${seeded.tournamentVersion},
        jsonb_build_object('matchups', jsonb_build_array())
      );
    `)).toThrow('Draws are locked after placement play starts')
  })

  it('releases an unstarted continuation when a correction settles the round', () => {
    const seeded = seedThreeTeamRound()
    runSql('select private.populate_placement_fixtures();')
    expect(secondRound(seeded.tournamentId)).not.toBe('')

    // A now scores 21 like C, while B falls to 20: A and C take both places.
    runSql(`
      select private.apply_team_correction(
        '${seeded.playoffMatchToCorrect}',
        'a',
        '[{"a":11,"b":9}]'::jsonb
      );
    `)

    expect(secondRound(seeded.tournamentId)).toBe('')
    expect(runSql(`
      select array[team_a_id, team_b_id]::uuid[] @> array['${seeded.teamA}', '${seeded.teamC}']::uuid[]
      from public.team_fixtures where id = '${seeded.finalFixtureId}';
    `)).toBe('t')
    // The released slot stays for reuse, unassigned and outside every round.
    expect(runSql(`
      select count(*) from public.team_fixtures
      where tournament_id = '${seeded.tournamentId}'
        and stage = 'qualification-playoff'
        and playoff_round_id is null
        and team_a_id is null and team_b_id is null;
    `)).toBe('1')
    expect(runSql(`
      select current_playoff_round_id = '${seeded.firstRoundId}'
      from public.tournament where id = '${seeded.tournamentId}';
    `)).toBe('t')
    // Nothing can record a result on the released slot while it waits.
    const releasedMatch = runSql(`
      select match.id from public.matches as match
      join public.team_fixtures as fixture on fixture.id = match.fixture_id
      where fixture.tournament_id = '${seeded.tournamentId}'
        and fixture.stage = 'qualification-playoff' and fixture.playoff_round_id is null;
    `)
    expect(() => runSql(`
      select private.team_mark_walkover(
        '${crypto.randomUUID()}',
        (select version from public.matches where id = '${releasedMatch}'),
        jsonb_build_object('matchId', '${releasedMatch}', 'winnerSide', 'a')
      );
    `)).toThrow('Fixture participants are not assigned')
  })

  it('gives a reused playoff slot a clean match', () => {
    const seeded = seedThreeTeamRound()
    runSql('select private.populate_placement_fixtures();')
    runSql(`
      select private.apply_team_correction(
        '${seeded.playoffMatchToCorrect}', 'a', '[{"a":11,"b":9}]'::jsonb
      );
    `)
    // Simulate a stale result left on the released slot, then restore the tie.
    runSql(`
      update public.matches as match
      set state = 'completed', result_kind = 'walkover', winner_side = 'a', court = 1
      from public.team_fixtures as fixture
      where fixture.id = match.fixture_id
        and fixture.tournament_id = '${seeded.tournamentId}'
        and fixture.stage = 'qualification-playoff' and fixture.playoff_round_id is null;
      select private.apply_team_correction(
        '${seeded.playoffMatchToCorrect}', 'a', '[{"a":12,"b":10}]'::jsonb
      );
    `)

    expect(secondRound(seeded.tournamentId)).not.toBe('')
    expect(runSql(`
      select match.state || ':' || coalesce(match.winner_side, '-') || ':' || match.court
      from public.matches as match
      join public.team_fixtures as fixture on fixture.id = match.fixture_id
      join public.qualification_playoff_rounds as round on round.id = fixture.playoff_round_id
      where round.tournament_id = '${seeded.tournamentId}' and round.round_number = 2;
    `)).toBe('unstarted:-:1')
  })

  it('preserves placement pairs when a qualifying correction cannot change participants', () => {
    const tournamentId = crypto.randomUUID()
    const [teamA, teamB] = [crypto.randomUUID(), crypto.randomUUID()]
    const qualifyingFixture = crypto.randomUUID()
    const qualifyingMatch = crypto.randomUUID()
    const finalFixture = crypto.randomUUID()
    const finalMatch = crypto.randomUUID()
    const [playerA, playerB] = [crypto.randomUUID(), crypto.randomUUID()]
    runSql(`
      insert into public.tournament (id, name, stage, finalists_confirmed_at)
      values ('${tournamentId}', 'Preserve pairs', 'knockouts', clock_timestamp());
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
      insert into public.matches (
        id, fixture_id, match_number, pair_a_player_1_id, pair_a_player_2_id
      ) values (
        '${finalMatch}', '${finalFixture}', 1, '${playerA}', '${playerB}'
      );
      insert into public.match_games (
        match_id, game_number, score_a, score_b, confirmed_at
      ) values ('${qualifyingMatch}', 1, 21, 10, clock_timestamp());
      select private.apply_team_correction(
        '${qualifyingMatch}', 'a', '[{"a":21,"b":11}]'::jsonb
      );
    `)

    expect(runSql(`
      select pair_a_player_1_id = '${playerA}'::uuid and pair_b_player_1_id is null
      from public.matches where id = '${finalMatch}';
    `)).toBe('t')
    expect(runSql(`
      select finalists_confirmed_at is not null
      from public.tournament where id = '${tournamentId}';
    `)).toBe('t')
  })
})
