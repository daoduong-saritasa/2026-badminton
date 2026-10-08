select private.lock_mutations();

alter table public.team_fixtures add column if not exists qualifying_court smallint;

do $$
declare
  tournament_row public.tournament%rowtype;
  fixture_ids uuid[];
  old_order integer[] := array[1, 6, 2, 3, 4, 5];
  position integer;
begin
  for tournament_row in select * from public.tournament
  loop
    if not exists (select 1 from public.team_fixtures
        where tournament_id = tournament_row.id and stage = 'qualifying'
          and qualifying_court is null) then
      continue;
    end if;
    if exists (
      select 1 from public.matches as match
      join public.team_fixtures as fixture on fixture.id = match.fixture_id
      where fixture.tournament_id = tournament_row.id and fixture.stage = 'qualifying'
        and (match.state <> 'unstarted' or match.result_kind is not null
          or match.winner_side is not null or exists (
            select 1 from public.match_games where match_id = match.id
          ))
    ) then
      raise exception 'Qualifying schedule cannot change after progress' using errcode = '55000';
    end if;
    select array_agg(id order by qualifying_order) into fixture_ids
    from public.team_fixtures where tournament_id = tournament_row.id and stage = 'qualifying';
    if array_length(fixture_ids, 1) <> 6
      or (select count(qualifying_order) from public.team_fixtures
          where tournament_id = tournament_row.id and stage = 'qualifying') <> 6 then
      raise exception 'Qualifying schedule requires six ordered fixtures' using errcode = '55000';
    end if;
    update public.team_fixtures set qualifying_order = null
    where id = any(fixture_ids);
    for position in 1..6 loop
      update public.team_fixtures
      set qualifying_order = position, qualifying_court = 1 + ((position - 1) % 2),
          version = version + 1, updated_at = clock_timestamp()
      where id = fixture_ids[old_order[position]];
    end loop;
    update public.matches as match
    set court = fixture.qualifying_court, version = match.version + 1, updated_at = clock_timestamp()
    from public.team_fixtures as fixture
    where fixture.id = match.fixture_id and fixture.tournament_id = tournament_row.id
      and fixture.stage = 'qualifying';
    update public.tournament set version = version + 1, result_revision = result_revision + 1,
      updated_at = clock_timestamp() where id = tournament_row.id;
  end loop;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint
      where conrelid = 'public.team_fixtures'::regclass
        and conname = 'team_fixtures_qualifying_court_check') then
    alter table public.team_fixtures add constraint team_fixtures_qualifying_court_check check (
      (stage = 'qualifying' and qualifying_order is not null and qualifying_court is not null and qualifying_court in (1, 2))
      or (stage <> 'qualifying' and qualifying_court is null)
    );
  end if;
end;
$$;

create or replace function private.team_save_roster(
  p_request_id uuid,
  p_expected_version integer,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tournament_row public.tournament%rowtype;
  team_data jsonb;
  player_data jsonb;
  new_team_id uuid;
  roster_team_ids uuid[] := array[]::uuid[];
  team_count integer;
  player_count integer;
  next_version integer;
begin
  if jsonb_typeof(p_payload -> 'teams') <> 'array'
    or length(btrim(p_payload ->> 'tournamentName')) = 0 then
    raise exception 'Invalid roster payload' using errcode = '22023';
  end if;

  team_count := jsonb_array_length(p_payload -> 'teams');
  select coalesce(sum(jsonb_array_length(value -> 'players')), 0)
  into player_count
  from jsonb_array_elements(p_payload -> 'teams');
  if team_count <> 4 or player_count <> 16 then
    raise exception 'Roster requires four teams and sixteen players'
      using errcode = '22023';
  end if;

  select * into tournament_row from public.tournament where singleton for update;
  if not found then
    if p_expected_version is distinct from 0 then
      raise exception 'Tournament version conflict' using errcode = '40001';
    end if;
    insert into public.tournament (name)
    values (btrim(p_payload ->> 'tournamentName'))
    returning * into tournament_row;
  elsif tournament_row.version <> p_expected_version then
    raise exception 'Tournament version conflict' using errcode = '40001';
  elsif tournament_row.stage <> 'setup'
    or exists (select 1 from public.matches where state <> 'unstarted') then
    raise exception 'Roster is locked after qualifying starts' using errcode = '55000';
  end if;

  update public.tournament
  set current_playoff_round_id = null
  where id = tournament_row.id;
  delete from public.qualification_playoff_rounds
  where tournament_id = tournament_row.id;
  delete from public.team_fixtures where tournament_id = tournament_row.id;
  delete from public.players as player where player.team_id in (
    select id from public.teams where tournament_id = tournament_row.id
  );
  delete from public.teams where tournament_id = tournament_row.id;

  for team_data in select value from jsonb_array_elements(p_payload -> 'teams')
  loop
    if length(btrim(team_data ->> 'name')) = 0
      or jsonb_typeof(team_data -> 'players') <> 'array'
      or jsonb_array_length(team_data -> 'players') <> 4
      or (select count(*) from jsonb_array_elements(team_data -> 'players')
          where (value ->> 'seed')::integer = 1) <> 2
      or (select count(*) from jsonb_array_elements(team_data -> 'players')
          where (value ->> 'seed')::integer = 2) <> 2 then
      raise exception 'Each team requires two seed 1 and two seed 2 players'
        using errcode = '22023';
    end if;
    insert into public.teams (tournament_id, name)
    values (tournament_row.id, btrim(team_data ->> 'name'))
    returning id into new_team_id;
    roster_team_ids := array_append(roster_team_ids, new_team_id);
    for player_data in select value from jsonb_array_elements(team_data -> 'players')
    loop
      if length(btrim(player_data ->> 'name')) = 0
        or (player_data ->> 'seed')::integer not in (1, 2) then
        raise exception 'Invalid player' using errcode = '22023';
      end if;
      insert into public.players (team_id, name, seed)
      values (
        new_team_id, btrim(player_data ->> 'name'),
        (player_data ->> 'seed')::smallint
      );
    end loop;
  end loop;

  insert into public.team_fixtures (
    tournament_id, stage, team_a_id, team_b_id, qualifying_order, qualifying_court
  )
  select tournament_row.id, 'qualifying',
    roster_team_ids[schedule.team_a], roster_team_ids[schedule.team_b],
    schedule.position, 1 + ((schedule.position - 1) % 2)
  from (values
    (1, 1, 2),
    (2, 3, 4),
    (3, 1, 3),
    (4, 2, 4),
    (5, 1, 4),
    (6, 2, 3)
  ) as schedule(position, team_a, team_b);
  insert into public.team_fixtures (tournament_id, stage)
  values
    (tournament_row.id, 'third-place'),
    (tournament_row.id, 'final');

  update public.tournament
  set name = btrim(p_payload ->> 'tournamentName'),
      stage = 'setup', setup_locked_at = null,
      finalists_confirmed_at = null,
      version = version + 1, result_revision = result_revision + 1,
      updated_at = clock_timestamp()
  where id = tournament_row.id returning version into next_version;
  return private.receipt(p_request_id, next_version);
end;
$$;

create or replace function private.sync_fixture_matches(p_fixture_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  fixture public.team_fixtures%rowtype;
begin
  select * into strict fixture
  from public.team_fixtures
  where id = p_fixture_id
  for update;

  if fixture.team_a_id is null or fixture.team_b_id is null then
    raise exception 'Fixture participants are not assigned' using errcode = '55000';
  end if;

  insert into public.matches (fixture_id, match_number, court)
  select fixture.id, match_number, case when fixture.stage = 'qualifying' then fixture.qualifying_court
    when match_number < 3 then match_number end
  from generate_series(1, case
    when fixture.stage = 'qualifying' then 2
    when fixture.stage = 'qualification-playoff' then 1
    else 3
  end) as match_number
  on conflict (fixture_id, match_number) do nothing;
end;
$$;

create or replace function private.team_start_match(
  p_session_id uuid,
  p_request_id uuid,
  p_expected_version integer,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_match public.matches%rowtype;
  fixture public.team_fixtures%rowtype;
  tournament_row public.tournament%rowtype;
  tally record;
  next_match_version integer;
  next_tournament_version integer;
begin
  perform private.lock_mutations();
  select * into strict target_match from public.matches
  where id = (p_payload ->> 'matchId')::uuid for update;
  select * into strict fixture from public.team_fixtures where id = target_match.fixture_id;
  select * into strict tournament_row from public.tournament where id = fixture.tournament_id;
  if target_match.version <> p_expected_version then
    raise exception 'Match version conflict' using errcode = '40001';
  end if;
  if tournament_row.stage = 'setup'
    or target_match.state <> 'unstarted' or target_match.court is null
    or fixture.team_a_id is null or fixture.team_b_id is null
    or target_match.pair_a_player_1_id is null
    or target_match.pair_b_player_1_id is null then
    raise exception 'Match is not ready to start' using errcode = '55000';
  end if;
  if fixture.stage = 'qualifying' then
    if fixture.qualifying_order is null or fixture.qualifying_court is null
      or target_match.court is distinct from fixture.qualifying_court then
      raise exception 'Qualifying schedule is invalid' using errcode = '55000';
    end if;
    if (select count(*) from public.team_fixtures as earlier
        where earlier.tournament_id = fixture.tournament_id and earlier.stage = 'qualifying'
          and (earlier.qualifying_order - 1) / 2 < (fixture.qualifying_order - 1) / 2)
        <> 2 * ((fixture.qualifying_order - 1) / 2)
      or exists (
        select 1 from public.team_fixtures as earlier
        where earlier.tournament_id = fixture.tournament_id and earlier.stage = 'qualifying'
          and (earlier.qualifying_order - 1) / 2 < (fixture.qualifying_order - 1) / 2
          and (select count(*) from public.matches as prerequisite
               where prerequisite.fixture_id = earlier.id and prerequisite.match_number in (1, 2)
                 and prerequisite.state = 'completed') <> 2
      ) then
      raise exception 'Earlier qualifying rounds must finish' using errcode = '55000';
    end if;
    if target_match.match_number = 2 and not exists (
      select 1 from public.matches where fixture_id = fixture.id
        and match_number = 1 and state = 'completed'
    ) then
      raise exception 'First qualifying match must finish' using errcode = '55000';
    end if;
  end if;
  if fixture.stage in ('third-place', 'final')
    and tournament_row.finalists_confirmed_at is null then
    raise exception 'Finalists must be confirmed before placement play'
      using errcode = '55000';
  end if;
  if fixture.stage = 'final' and not exists (
    select 1 from public.team_fixtures as third_place
    where third_place.tournament_id = fixture.tournament_id
      and third_place.stage = 'third-place'
      and private.fixture_winner_team_id(third_place.id) is not null
  ) then
    raise exception 'Third place must finish before the final starts'
      using errcode = '55000';
  end if;
  if exists (
    select 1 from public.matches
    where id <> target_match.id and state = 'playing' and court = target_match.court
  ) then
    raise exception 'Court is occupied' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.matches as playing
    where playing.id <> target_match.id and playing.state = 'playing'
      and array[
        playing.pair_a_player_1_id, playing.pair_a_player_2_id,
        playing.pair_b_player_1_id, playing.pair_b_player_2_id
      ] && array[
        target_match.pair_a_player_1_id, target_match.pair_a_player_2_id,
        target_match.pair_b_player_1_id, target_match.pair_b_player_2_id
      ]
  ) then
    raise exception 'A player is already playing' using errcode = '55000';
  end if;
  if fixture.stage in ('third-place', 'final') and target_match.match_number = 3 then
    select * into tally from private.fixture_tally(fixture.id);
    if tally.wins_a <> 1 or tally.wins_b <> 1
      or (select count(*) from public.matches
          where fixture_id = fixture.id and match_number in (1, 2)
            and state = 'completed') <> 2 then
      raise exception 'Decider is not eligible' using errcode = '55000';
    end if;
  end if;
  insert into private.match_ownership (match_id, session_id)
  values (target_match.id, p_session_id)
  on conflict (match_id) do update
  set session_id = excluded.session_id, claimed_at = clock_timestamp();
  insert into public.match_games (match_id, game_number)
  values (target_match.id, 1)
  on conflict (match_id, game_number) do nothing;
  update public.matches
  set state = 'playing', version = version + 1, updated_at = clock_timestamp()
  where id = target_match.id returning version into next_match_version;
  next_tournament_version := private.bump_team_tournament();
  return private.receipt(
    p_request_id, next_tournament_version, target_match.id, next_match_version
  );
end;
$$;

create or replace function private.team_assign_courts(
  p_request_id uuid,
  p_expected_version integer,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tournament_row public.tournament%rowtype;
  assignment jsonb;
  target_match public.matches%rowtype;
  fixture public.team_fixtures%rowtype;
  sibling public.team_fixtures%rowtype;
  requested jsonb := '{}'::jsonb;
  desired_court smallint;
  next_version integer;
begin
  perform private.lock_mutations();
  select * into strict tournament_row from public.tournament where singleton for update;
  if tournament_row.version <> p_expected_version then
    raise exception 'Tournament version conflict' using errcode = '40001';
  end if;
  if jsonb_typeof(p_payload -> 'assignments') is distinct from 'array'
    or jsonb_array_length(p_payload -> 'assignments') = 0 then
    raise exception 'Invalid court assignments' using errcode = '22023';
  end if;
  for assignment in select value from jsonb_array_elements(p_payload -> 'assignments')
  loop
    desired_court := (assignment ->> 'court')::smallint;
    if desired_court is null or desired_court not in (1, 2) then
      raise exception 'Court must be 1 or 2' using errcode = '22023';
    end if;
    select * into target_match from public.matches where id = (assignment ->> 'matchId')::uuid;
    if not found or target_match.state <> 'unstarted' then
      raise exception 'Only unstarted matches can be assigned' using errcode = '55000';
    end if;
    select * into strict fixture from public.team_fixtures where id = target_match.fixture_id;
    if fixture.tournament_id <> tournament_row.id or fixture.team_a_id is null or fixture.team_b_id is null then
      raise exception 'Fixture participants are not assigned' using errcode = '55000';
    end if;
    if fixture.stage = 'qualifying' then
      if requested ? fixture.id::text and (requested ->> fixture.id::text)::smallint <> desired_court then
        raise exception 'Invalid court assignments' using errcode = '22023';
      end if;
      requested := requested || jsonb_build_object(fixture.id::text, desired_court);
    else
      update public.matches set court = desired_court, version = version + 1,
        updated_at = clock_timestamp() where id = target_match.id;
    end if;
  end loop;
  for fixture in select * from public.team_fixtures where id::text in (select jsonb_object_keys(requested))
  loop
    select * into strict fixture from public.team_fixtures where id = fixture.id;
    desired_court := (requested ->> fixture.id::text)::smallint;
    if desired_court = fixture.qualifying_court then continue; end if;
    select * into strict sibling from public.team_fixtures
    where tournament_id = fixture.tournament_id and stage = 'qualifying' and id <> fixture.id
      and (qualifying_order - 1) / 2 = (fixture.qualifying_order - 1) / 2;
    if requested ? sibling.id::text and (requested ->> sibling.id::text)::smallint <> 3 - desired_court then
      raise exception 'Invalid court assignments' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.matches as match
      where match.fixture_id in (fixture.id, sibling.id)
        and (match.state <> 'unstarted' or match.result_kind is not null
          or exists (select 1 from public.match_games where match_id = match.id))
    ) then
      raise exception 'Qualifying courts are locked after progress' using errcode = '55000';
    end if;
    update public.team_fixtures
    set qualifying_court = case when id = fixture.id then desired_court else 3 - desired_court end,
        version = version + 1, updated_at = clock_timestamp()
    where id in (fixture.id, sibling.id);
    update public.matches as match
    set court = updated.qualifying_court, version = match.version + 1, updated_at = clock_timestamp()
    from public.team_fixtures as updated
    where match.fixture_id = updated.id and updated.id in (fixture.id, sibling.id);
  end loop;
  next_version := private.bump_team_tournament();
  return private.receipt(p_request_id, next_version);
end;
$$;
