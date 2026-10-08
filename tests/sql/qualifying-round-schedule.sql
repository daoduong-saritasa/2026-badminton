\set ON_ERROR_STOP on
begin;
select private.lock_mutations();

do $$
begin
  if exists (select 1 from public.tournament) then
    raise exception 'Scheduling regression requires an empty disposable database';
  end if;
end;
$$;

create function pg_temp.expect_failure(statement text, expected_message text)
returns void language plpgsql as $$
declare actual_message text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics actual_message = message_text;
  end;
  if actual_message is distinct from expected_message then
    raise exception 'Expected %, received %', expected_message, actual_message;
  end if;
end;
$$;

select private.team_save_roster(extensions.gen_random_uuid(), 0, jsonb_build_object(
  'tournamentName', 'Scheduling regression',
  'teams', (select jsonb_agg(jsonb_build_object('name', team_name, 'players', (
    select jsonb_agg(jsonb_build_object('name', team_name || player_number,
      'seed', case when player_number <= 2 then 1 else 2 end))
    from generate_series(1, 4) as player_number
  )) order by team_name) from unnest(array['A', 'B', 'C', 'D']) as team_name)
));
select private.team_start_qualifying(extensions.gen_random_uuid(),
  (select version from public.tournament), '{}'::jsonb);

do $$
declare fixture public.team_fixtures%rowtype; match public.matches%rowtype; side text; selected_team_id uuid; seed_one uuid[]; seed_two uuid[];
begin
  assert (select array_agg(a.name || b.name order by fixture.qualifying_order)
    from public.team_fixtures as fixture
    join public.teams as a on a.id = fixture.team_a_id
    join public.teams as b on b.id = fixture.team_b_id
    where fixture.stage = 'qualifying') = array['AB', 'CD', 'AC', 'BD', 'AD', 'BC'];
  assert (select count(*) from public.matches as match join public.team_fixtures as fixture
    on fixture.id = match.fixture_id where match.court = fixture.qualifying_court) = 12;
  for fixture in select * from public.team_fixtures where stage = 'qualifying' loop
    for match in select * from public.matches where fixture_id = fixture.id loop
      foreach side in array array['a', 'b'] loop
        selected_team_id := case when side = 'a' then fixture.team_a_id else fixture.team_b_id end;
        select array_agg(id order by name) into seed_one from public.players where players.team_id = selected_team_id and seed = 1;
        select array_agg(id order by name) into seed_two from public.players where players.team_id = selected_team_id and seed = 2;
        perform private.set_match_pair(match.id, side, seed_one[match.match_number], seed_two[match.match_number], false);
      end loop;
    end loop;
  end loop;
end;
$$;

create temporary table preserved_matches on commit drop as
select id, fixture_id, pair_a_player_1_id, pair_a_player_2_id, pair_b_player_1_id, pair_b_player_2_id from public.matches;
create temporary table old_positions on commit drop as select id, qualifying_order from public.team_fixtures where stage = 'qualifying';
alter table public.team_fixtures drop constraint team_fixtures_qualifying_court_check;
update public.team_fixtures set qualifying_order = null, qualifying_court = null where stage = 'qualifying';
update public.team_fixtures as fixture set qualifying_order = case old.qualifying_order
  when 1 then 1 when 2 then 6 when 3 then 2 when 4 then 3 when 5 then 4 when 6 then 5 end
from old_positions as old where fixture.id = old.id;
\ir ../../supabase/migrations/202610080004_qualifying_round_schedule.sql

do $$
begin
  assert not exists (select * from preserved_matches except
    select id, fixture_id, pair_a_player_1_id, pair_a_player_2_id, pair_b_player_1_id, pair_b_player_2_id from public.matches);
  assert not exists (select 1 from public.team_fixtures as fixture join old_positions as old on old.id = fixture.id
    where fixture.qualifying_order <> old.qualifying_order);
end;
$$;
create temporary table converted_versions on commit drop as select id, version from public.matches;
\ir ../../supabase/migrations/202610080004_qualifying_round_schedule.sql

do $$
begin
  assert not exists (select 1 from public.matches as match join converted_versions as old on old.id = match.id where match.version <> old.version);
end;
$$;

insert into auth.users (id) values ('10000000-0000-4000-8000-000000000001');
insert into auth.sessions (id, user_id) values
  ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001');

do $$
declare
  first_match public.matches%rowtype;
  second_match public.matches%rowtype;
  next_match public.matches%rowtype;
  match public.matches%rowtype;
  old_version integer;
  saved_schedule jsonb;
  tournament_row public.tournament%rowtype;
begin
  select match.* into first_match from public.matches as match join public.team_fixtures as fixture on fixture.id = match.fixture_id
    where fixture.qualifying_order = 1 and match.match_number = 1;
  select * into second_match from public.matches where fixture_id = first_match.fixture_id and match_number = 2;
  select match.* into next_match from public.matches as match join public.team_fixtures as fixture on fixture.id = match.fixture_id
    where fixture.qualifying_order = 3 and match.match_number = 1;
  perform pg_temp.expect_failure(format('select private.team_start_match(%L, %L, %s, %L::jsonb)',
    '10000000-0000-4000-8000-000000000002', extensions.gen_random_uuid(), second_match.version,
    jsonb_build_object('matchId', second_match.id)), 'First qualifying match must finish');
  perform pg_temp.expect_failure(format('select private.team_start_match(%L, %L, %s, %L::jsonb)',
    '10000000-0000-4000-8000-000000000002', extensions.gen_random_uuid(), next_match.version,
    jsonb_build_object('matchId', next_match.id)), 'Earlier qualifying rounds must finish');
  select version into old_version from public.tournament;
  perform private.team_assign_courts(extensions.gen_random_uuid(), old_version,
    jsonb_build_object('assignments', jsonb_build_array(jsonb_build_object('matchId', first_match.id, 'court', 2))));
  assert (select count(*) from public.matches where fixture_id = first_match.fixture_id and court = 2) = 2;
  assert (select count(*) from public.matches as match join public.team_fixtures as fixture on fixture.id = match.fixture_id
    where fixture.qualifying_order = 2 and match.court = 1) = 2;
  perform pg_temp.expect_failure(format('select private.team_assign_courts(%L, %s, %L::jsonb)',
    extensions.gen_random_uuid(), old_version, jsonb_build_object('assignments', jsonb_build_array(jsonb_build_object('matchId', first_match.id, 'court', 1)))), 'Tournament version conflict');
  select * into first_match from public.matches where id = first_match.id;
  perform private.team_start_match('10000000-0000-4000-8000-000000000002', extensions.gen_random_uuid(), first_match.version, jsonb_build_object('matchId', first_match.id));
  select version into old_version from public.tournament;
  perform pg_temp.expect_failure(format('select private.team_assign_courts(%L, %s, %L::jsonb)',
    extensions.gen_random_uuid(), old_version, jsonb_build_object('assignments', jsonb_build_array(jsonb_build_object('matchId', second_match.id, 'court', 1)))), 'Qualifying courts are locked after progress');
  for match in select match.* from public.matches as match join public.team_fixtures as fixture on fixture.id = match.fixture_id
    where fixture.qualifying_order in (1, 2) order by fixture.qualifying_order, match.match_number loop
    perform private.team_mark_walkover(extensions.gen_random_uuid(), match.version, jsonb_build_object('matchId', match.id, 'winnerSide', 'a'));
  end loop;
  select * into next_match from public.matches where id = next_match.id;
  perform private.team_start_match('10000000-0000-4000-8000-000000000002', extensions.gen_random_uuid(), next_match.version, jsonb_build_object('matchId', next_match.id));
  assert (select state from public.matches where id = next_match.id) = 'playing';
  select jsonb_agg(jsonb_build_array(id, qualifying_order, qualifying_court) order by id) into saved_schedule from public.team_fixtures;
  select * into tournament_row from public.tournament;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update private.maintenance_state set reset_enabled = true where singleton;
  perform public.reset_tournament(extensions.gen_random_uuid(), (select reset_generation from private.maintenance_state),
    tournament_row.id, tournament_row.version, 'progress', tournament_row.name);
  assert (select jsonb_agg(jsonb_build_array(id, qualifying_order, qualifying_court) order by id) from public.team_fixtures) = saved_schedule;
  assert not exists (select 1 from public.matches where state <> 'unstarted' or pair_a_player_1_id is not null);
  assert not exists (select 1 from public.match_games);
end;
$$;
rollback;
