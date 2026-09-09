-- Keep setup replacement compatible with the hosted database safe-delete guard.
create or replace function public.save_setup(
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
  staff_session uuid;
  replay jsonb;
  setup jsonb := p_payload -> 'setup';
  pair_data jsonb;
  pair_count integer;
  group_a_count integer;
  group_b_count integer;
  tournament_row public.tournament%rowtype;
  player_a uuid;
  player_b uuid;
  pair_group text;
  pair_players jsonb;
  next_version integer;
  response jsonb;
begin
  staff_session := private.require_staff_access();
  perform private.lock_mutations();
  replay := private.replay_mutation(staff_session, p_request_id, 'save_setup', p_expected_version, p_payload);
  if replay is not null then return replay; end if;

  if jsonb_typeof(setup) <> 'object'
    or jsonb_typeof(setup -> 'pairs') <> 'array'
    or length(btrim(setup ->> 'tournamentName')) = 0 then
    raise exception 'Invalid setup payload' using errcode = '22023';
  end if;

  pair_count := jsonb_array_length(setup -> 'pairs');
  select count(*) filter (where value ->> 'group' = 'A'),
         count(*) filter (where value ->> 'group' = 'B')
  into group_a_count, group_b_count
  from jsonb_array_elements(setup -> 'pairs');

  if pair_count not between 6 and 8
    or (pair_count = 6 and (group_a_count <> 3 or group_b_count <> 3))
    or (pair_count = 7 and (group_a_count <> 4 or group_b_count <> 3))
    or (pair_count = 8 and (group_a_count <> 4 or group_b_count <> 4)) then
    raise exception 'Setup requires groups sized 3+3, 4+3, or 4+4' using errcode = '22023';
  end if;

  select * into tournament_row from public.tournament where singleton for update;
  if not found then
    if p_expected_version is distinct from 0 then
      raise exception 'Tournament version conflict' using errcode = '40001';
    end if;
    insert into public.tournament (name) values (setup ->> 'tournamentName') returning * into tournament_row;
  elsif tournament_row.version <> p_expected_version then
    raise exception 'Tournament version conflict' using errcode = '40001';
  elsif tournament_row.setup_locked_at is not null
    or exists (select 1 from public.matches where state <> 'unstarted') then
    raise exception 'Setup is locked after play starts' using errcode = '55000';
  end if;

  delete from public.matches where tournament_id = tournament_row.id;
  delete from public.tie_resolutions where tournament_id = tournament_row.id;
  delete from public.pairs where id is not null;
  delete from public.players where id is not null;

  for pair_data in select value from jsonb_array_elements(setup -> 'pairs') loop
    pair_players := pair_data -> 'players';
    pair_group := pair_data ->> 'group';
    if jsonb_typeof(pair_players) <> 'array' or jsonb_array_length(pair_players) <> 2
      or pair_group not in ('A', 'B')
      or length(btrim(pair_players -> 0 ->> 'name')) = 0
      or length(btrim(pair_players -> 1 ->> 'name')) = 0
      or (pair_players -> 0 ->> 'seed')::integer not in (1, 2)
      or (pair_players -> 1 ->> 'seed')::integer not in (1, 2) then
      raise exception 'Invalid pair in setup' using errcode = '22023';
    end if;

    insert into public.players (name, seed)
    values (btrim(pair_players -> 0 ->> 'name'), (pair_players -> 0 ->> 'seed')::integer)
    returning id into player_a;
    insert into public.players (name, seed)
    values (btrim(pair_players -> 1 ->> 'name'), (pair_players -> 1 ->> 'seed')::integer)
    returning id into player_b;
    insert into public.pairs (team_name, player_a_id, player_b_id, group_code)
    values (nullif(btrim(pair_data ->> 'teamName'), ''), player_a, player_b, pair_group);
  end loop;

  update public.tournament
  set name = btrim(setup ->> 'tournamentName'),
      stage = 'setup',
      version = version + 1,
      updated_at = clock_timestamp()
  where singleton
  returning version into next_version;

  response := private.receipt(p_request_id, next_version);
  return private.store_mutation(staff_session, p_request_id, 'save_setup', p_expected_version, p_payload, response);
end;
$$;

