-- A PL/pgSQL variable named `team_id` made `delete from public.players where
-- team_id in (...)` ambiguous, so every roster save failed with 42702. The
-- function is otherwise unchanged; `create or replace` keeps its privileges.

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
  team_count integer;
  player_count integer;
  group_a_count integer;
  group_b_count integer;
  next_version integer;
begin
  if jsonb_typeof(p_payload -> 'teams') <> 'array'
    or length(btrim(p_payload ->> 'tournamentName')) = 0 then
    raise exception 'Invalid roster payload' using errcode = '22023';
  end if;

  team_count := jsonb_array_length(p_payload -> 'teams');
  select count(*) filter (where value ->> 'group' = 'A'),
         count(*) filter (where value ->> 'group' = 'B'),
         coalesce(sum(jsonb_array_length(value -> 'players')), 0)
  into group_a_count, group_b_count, player_count
  from jsonb_array_elements(p_payload -> 'teams');
  if team_count <> 4 or group_a_count <> 2 or group_b_count <> 2 or player_count <> 16 then
    raise exception 'Roster requires four teams, two per group, and sixteen players'
      using errcode = '22023';
  end if;

  select * into tournament_row from public.tournament where singleton for update;
  if not found then
    if p_expected_version is distinct from 0 then
      raise exception 'Tournament version conflict' using errcode = '40001';
    end if;
    insert into public.tournament (name) values (btrim(p_payload ->> 'tournamentName'))
    returning * into tournament_row;
  elsif tournament_row.version <> p_expected_version then
    raise exception 'Tournament version conflict' using errcode = '40001';
  elsif tournament_row.stage <> 'setup'
    or exists (select 1 from public.matches where state <> 'unstarted') then
    raise exception 'Roster is locked after group play starts' using errcode = '55000';
  end if;

  delete from public.team_fixtures where tournament_id = tournament_row.id;
  delete from public.players where team_id in (
    select id from public.teams where tournament_id = tournament_row.id
  );
  delete from public.teams where tournament_id = tournament_row.id;

  for team_data in select value from jsonb_array_elements(p_payload -> 'teams')
  loop
    if length(btrim(team_data ->> 'name')) = 0
      or team_data ->> 'group' not in ('A', 'B')
      or jsonb_typeof(team_data -> 'players') <> 'array'
      or jsonb_array_length(team_data -> 'players') <> 4
      or (select count(*) from jsonb_array_elements(team_data -> 'players') where (value ->> 'seed')::integer = 1) <> 2
      or (select count(*) from jsonb_array_elements(team_data -> 'players') where (value ->> 'seed')::integer = 2) <> 2 then
      raise exception 'Each team requires two seed 1 and two seed 2 players'
        using errcode = '22023';
    end if;
    insert into public.teams (tournament_id, name, group_code)
    values (tournament_row.id, btrim(team_data ->> 'name'), team_data ->> 'group')
    returning id into new_team_id;
    for player_data in select value from jsonb_array_elements(team_data -> 'players')
    loop
      if length(btrim(player_data ->> 'name')) = 0
        or (player_data ->> 'seed')::integer not in (1, 2) then
        raise exception 'Invalid player' using errcode = '22023';
      end if;
      insert into public.players (team_id, name, seed)
      values (new_team_id, btrim(player_data ->> 'name'), (player_data ->> 'seed')::smallint);
    end loop;
  end loop;

  insert into public.team_fixtures (tournament_id, stage, group_code, team_a_id, team_b_id)
  select tournament_row.id, 'group', group_code,
         (array_agg(id order by ordinal))[1],
         (array_agg(id order by ordinal))[2]
  from (
    select id, group_code,
           row_number() over (partition by group_code order by name, id) as ordinal
    from public.teams where tournament_id = tournament_row.id
  ) as ordered_teams
  group by group_code;

  update public.tournament
  set name = btrim(p_payload ->> 'tournamentName'),
      stage = 'setup', setup_locked_at = null,
      version = version + 1, result_revision = result_revision + 1,
      updated_at = clock_timestamp()
  where id = tournament_row.id returning version into next_version;
  return private.receipt(p_request_id, next_version);
end;
$$;
