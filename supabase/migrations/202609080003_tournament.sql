create or replace function private.lock_mutations()
returns void
language sql
security definer
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(20260908, 1);
$$;

create or replace function private.replay_mutation(
  p_session_id uuid,
  p_request_id uuid,
  p_operation text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  logged private.mutation_log%rowtype;
  fingerprint text := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );
begin
  select * into logged
  from private.mutation_log
  where request_id = p_request_id and staff_session_id = p_session_id;

  if not found then
    return null;
  end if;

  if logged.operation <> p_operation or logged.payload_fingerprint <> fingerprint then
    raise exception 'Request ID was already used with different input' using errcode = '22023';
  end if;

  return logged.response;
end;
$$;

create or replace function private.store_mutation(
  p_session_id uuid,
  p_request_id uuid,
  p_operation text,
  p_payload jsonb,
  p_response jsonb,
  p_match_id uuid default null,
  p_point_side text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.mutation_log (
    request_id,
    staff_session_id,
    operation,
    payload_fingerprint,
    response,
    match_id,
    point_side
  ) values (
    p_request_id,
    p_session_id,
    p_operation,
    pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(p_payload::text, 'UTF8'), 'sha256'),
      'hex'
    ),
    p_response,
    p_match_id,
    p_point_side
  );

  return p_response;
end;
$$;

create or replace function private.require_tournament_version(p_expected_version integer)
returns public.tournament
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_tournament public.tournament%rowtype;
begin
  select * into current_tournament
  from public.tournament
  where singleton
  for update;

  if not found then
    raise exception 'Tournament is not configured' using errcode = 'P0002';
  end if;

  if current_tournament.version <> p_expected_version then
    raise exception 'Tournament version conflict' using errcode = '40001';
  end if;

  return current_tournament;
end;
$$;

create or replace function private.receipt(
  p_request_id uuid,
  p_tournament_version integer,
  p_match_id uuid default null,
  p_match_version integer default null
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'requestId', p_request_id,
    'tournamentVersion', p_tournament_version,
    'matchId', p_match_id,
    'matchVersion', p_match_version
  );
$$;

create or replace function public.get_tournament_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'tournament', to_jsonb(tournament_row) - 'singleton' - 'created_at' - 'updated_at',
    'players', coalesce((select jsonb_agg(to_jsonb(player_row) - 'created_at' order by player_row.id) from public.players as player_row), '[]'::jsonb),
    'pairs', coalesce((select jsonb_agg(to_jsonb(pair_row) - 'created_at' order by pair_row.id) from public.pairs as pair_row), '[]'::jsonb),
    'matches', coalesce((select jsonb_agg(to_jsonb(match_row) - 'created_at' - 'updated_at' order by match_row.playing_order, match_row.court nulls last, match_row.id) from public.matches as match_row), '[]'::jsonb),
    'tieResolutions', coalesce((select jsonb_agg(to_jsonb(tie_row) - 'created_at' - 'updated_at' order by tie_row.group_code) from public.tie_resolutions as tie_row), '[]'::jsonb)
  )
  from public.tournament as tournament_row
  where tournament_row.singleton;
$$;

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
  replay := private.replay_mutation(staff_session, p_request_id, 'save_setup', p_payload);
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
    if p_expected_version <> 0 then
      raise exception 'Tournament version conflict' using errcode = '40001';
    end if;
    insert into public.tournament (name) values (setup ->> 'tournamentName') returning * into tournament_row;
  elsif tournament_row.version <> p_expected_version then
    raise exception 'Tournament version conflict' using errcode = '40001';
  elsif tournament_row.setup_locked_at is not null
    or exists (select 1 from public.matches where state <> 'unstarted') then
    raise exception 'Setup is locked after play starts' using errcode = '55000';
  end if;

  delete from public.matches;
  delete from public.tie_resolutions;
  delete from public.pairs;
  delete from public.players;

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
  return private.store_mutation(staff_session, p_request_id, 'save_setup', p_payload, response);
end;
$$;

create or replace function public.generate_fixtures(
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
  tournament_row public.tournament%rowtype;
  selected record;
  second_selected record;
  prior_pairs uuid[] := array[]::uuid[];
  slot integer := 1;
  semifinal_one uuid;
  semifinal_two uuid;
  next_version integer;
  response jsonb;
begin
  staff_session := private.require_staff_access();
  perform private.lock_mutations();
  replay := private.replay_mutation(staff_session, p_request_id, 'generate_fixtures', p_payload);
  if replay is not null then return replay; end if;
  tournament_row := private.require_tournament_version(p_expected_version);

  if tournament_row.setup_locked_at is not null or exists (select 1 from public.matches) then
    raise exception 'Fixtures already exist or setup is locked' using errcode = '55000';
  end if;

  create temporary table fixture_candidates (
    candidate_id bigint generated always as identity,
    group_code text not null,
    pair_a_id uuid not null,
    pair_b_id uuid not null
  ) on commit drop;

  insert into fixture_candidates (group_code, pair_a_id, pair_b_id)
  select first_pair.group_code, first_pair.id, second_pair.id
  from public.pairs as first_pair
  join public.pairs as second_pair
    on second_pair.group_code = first_pair.group_code and second_pair.id > first_pair.id;

  while exists (select 1 from fixture_candidates) loop
    select * into selected
    from fixture_candidates
    order by
      ((pair_a_id = any(prior_pairs) or pair_b_id = any(prior_pairs)))::integer,
      candidate_id
    limit 1;

    select * into second_selected
    from fixture_candidates
    where candidate_id <> selected.candidate_id
      and pair_a_id not in (selected.pair_a_id, selected.pair_b_id)
      and pair_b_id not in (selected.pair_a_id, selected.pair_b_id)
    order by
      ((pair_a_id = any(prior_pairs) or pair_b_id = any(prior_pairs)))::integer,
      candidate_id
    limit 1;

    insert into public.matches (
      tournament_id, round, group_code, pair_a_id, pair_b_id, court, playing_order
    ) values (
      tournament_row.id, 'group', selected.group_code,
      selected.pair_a_id, selected.pair_b_id, 1, slot
    );

    prior_pairs := array[selected.pair_a_id, selected.pair_b_id];
    delete from fixture_candidates where candidate_id = selected.candidate_id;

    if second_selected.candidate_id is not null then
      insert into public.matches (
        tournament_id, round, group_code, pair_a_id, pair_b_id, court, playing_order
      ) values (
        tournament_row.id, 'group', second_selected.group_code,
        second_selected.pair_a_id, second_selected.pair_b_id, 2, slot
      );
      prior_pairs := prior_pairs || array[second_selected.pair_a_id, second_selected.pair_b_id];
      delete from fixture_candidates where candidate_id = second_selected.candidate_id;
    end if;

    slot := slot + 1;
  end loop;

  insert into public.matches (
    tournament_id, round, source_a_label, source_b_label, court, playing_order
  ) values (tournament_row.id, 'semifinal', 'A1', 'B2', 1, slot)
  returning id into semifinal_one;
  insert into public.matches (
    tournament_id, round, source_a_label, source_b_label, court, playing_order
  ) values (tournament_row.id, 'semifinal', 'B1', 'A2', 2, slot)
  returning id into semifinal_two;
  insert into public.matches (
    tournament_id, round, source_a_label, source_b_label,
    source_a_match_id, source_b_match_id, court, playing_order
  ) values (
    tournament_row.id, 'final', 'SF1 winner', 'SF2 winner',
    semifinal_one, semifinal_two, 1, slot + 1
  );

  update public.tournament
  set stage = 'groups', version = version + 1, updated_at = clock_timestamp()
  where id = tournament_row.id
  returning version into next_version;

  response := private.receipt(p_request_id, next_version);
  return private.store_mutation(staff_session, p_request_id, 'generate_fixtures', p_payload, response);
end;
$$;

create or replace function public.assign_courts(
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
  tournament_row public.tournament%rowtype;
  assignment jsonb;
  next_version integer;
  response jsonb;
begin
  staff_session := private.require_staff_access();
  perform private.lock_mutations();
  replay := private.replay_mutation(staff_session, p_request_id, 'assign_courts', p_payload);
  if replay is not null then return replay; end if;
  tournament_row := private.require_tournament_version(p_expected_version);

  if jsonb_typeof(p_payload -> 'assignments') <> 'array' then
    raise exception 'Assignments must be an array' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_payload -> 'assignments') as item
    group by (item ->> 'playingOrder')::integer, (item ->> 'court')::integer
    having count(*) > 1
  ) then
    raise exception 'Court assignments must be unique' using errcode = '23505';
  end if;

  for assignment in select value from jsonb_array_elements(p_payload -> 'assignments') loop
    if (assignment ->> 'court')::integer not in (1, 2)
      or (assignment ->> 'playingOrder')::integer <= 0 then
      raise exception 'Invalid court assignment' using errcode = '22023';
    end if;

    update public.matches
    set court = (assignment ->> 'court')::integer,
        playing_order = (assignment ->> 'playingOrder')::integer,
        updated_at = clock_timestamp()
    where id = (assignment ->> 'matchId')::uuid and state = 'unstarted';

    if not found then
      raise exception 'Only unstarted matches can be assigned' using errcode = '55000';
    end if;
  end loop;

  update public.tournament
  set version = version + 1, updated_at = clock_timestamp()
  where id = tournament_row.id
  returning version into next_version;

  response := private.receipt(p_request_id, next_version);
  return private.store_mutation(staff_session, p_request_id, 'assign_courts', p_payload, response);
end;
$$;

revoke all on function public.get_tournament_snapshot() from public;
revoke all on function public.save_setup(uuid, integer, jsonb) from public, anon;
revoke all on function public.generate_fixtures(uuid, integer, jsonb) from public, anon;
revoke all on function public.assign_courts(uuid, integer, jsonb) from public, anon;
grant execute on function public.get_tournament_snapshot() to anon, authenticated;
grant execute on function public.save_setup(uuid, integer, jsonb) to authenticated;
grant execute on function public.generate_fixtures(uuid, integer, jsonb) to authenticated;
grant execute on function public.assign_courts(uuid, integer, jsonb) to authenticated;

revoke all on function private.lock_mutations() from public, anon, authenticated, service_role;
revoke all on function private.replay_mutation(uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.store_mutation(uuid, uuid, text, jsonb, jsonb, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.require_tournament_version(integer) from public, anon, authenticated, service_role;
revoke all on function private.receipt(uuid, integer, uuid, integer) from public, anon, authenticated, service_role;

create or replace function private.is_winning_score(p_score_a integer, p_score_b integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_score_a is null or p_score_b is null
      or p_score_a < 0 or p_score_b < 0
      or p_score_a > 30 or p_score_b > 30
      or p_score_a = p_score_b then false
    when greatest(p_score_a, p_score_b) = 30
      then least(p_score_a, p_score_b) in (28, 29)
    when greatest(p_score_a, p_score_b) = 21
      then least(p_score_a, p_score_b) <= 19
    else greatest(p_score_a, p_score_b) between 22 and 29
      and abs(p_score_a - p_score_b) = 2
  end;
$$;

create or replace function private.require_match_version(
  p_match_id uuid,
  p_expected_version integer
)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_match public.matches%rowtype;
begin
  select * into current_match from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found' using errcode = 'P0002'; end if;
  if current_match.version <> p_expected_version then
    raise exception 'Match version conflict' using errcode = '40001';
  end if;
  return current_match;
end;
$$;

create or replace function private.require_match_owner(p_match_id uuid, p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from private.match_ownership
    where match_id = p_match_id and session_id = p_session_id
  ) then
    raise exception 'Current session does not own this match' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.bump_tournament()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare next_version integer;
begin
  update public.tournament
  set version = version + 1, updated_at = clock_timestamp()
  where singleton
  returning version into strict next_version;
  return next_version;
end;
$$;

create or replace function public.start_scoring(p_request_id uuid, p_expected_version integer, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  staff_session uuid; replay jsonb; current_match public.matches%rowtype;
  next_match_version integer; next_tournament_version integer; response jsonb;
  target_match_id uuid := (p_payload ->> 'matchId')::uuid;
begin
  staff_session := private.require_staff_access(); perform private.lock_mutations();
  replay := private.replay_mutation(staff_session, p_request_id, 'start_scoring', p_payload);
  if replay is not null then return replay; end if;
  current_match := private.require_match_version(target_match_id, p_expected_version);
  if current_match.state <> 'unstarted' or current_match.pair_a_id is null
    or current_match.pair_b_id is null or current_match.court is null then
    raise exception 'Match is not ready to start' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.matches as active
    where active.state = 'playing' and (
      active.court = current_match.court
      or active.pair_a_id in (current_match.pair_a_id, current_match.pair_b_id)
      or active.pair_b_id in (current_match.pair_a_id, current_match.pair_b_id)
    )
  ) then raise exception 'Court or pair is already playing' using errcode = '23505'; end if;

  update public.tournament
  set setup_locked_at = coalesce(setup_locked_at, clock_timestamp()), updated_at = clock_timestamp()
  where singleton;
  update public.matches
  set state = 'playing', score_a = 0, score_b = 0, version = version + 1,
      updated_at = clock_timestamp()
  where id = target_match_id returning version into next_match_version;
  insert into private.match_ownership (match_id, session_id)
  values (target_match_id, staff_session);
  next_tournament_version := private.bump_tournament();
  response := private.receipt(p_request_id, next_tournament_version, target_match_id, next_match_version);
  return private.store_mutation(staff_session, p_request_id, 'start_scoring', p_payload, response, target_match_id);
end;
$$;

create or replace function public.take_over(p_request_id uuid, p_expected_version integer, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  staff_session uuid; replay jsonb; current_match public.matches%rowtype;
  next_match_version integer; next_tournament_version integer; response jsonb;
  target_match_id uuid := (p_payload ->> 'matchId')::uuid;
begin
  staff_session := private.require_staff_access(); perform private.lock_mutations();
  replay := private.replay_mutation(staff_session, p_request_id, 'take_over', p_payload);
  if replay is not null then return replay; end if;
  current_match := private.require_match_version(target_match_id, p_expected_version);
  if current_match.state <> 'playing' then
    raise exception 'Only a playing match can be taken over' using errcode = '55000';
  end if;
  insert into private.match_ownership (match_id, session_id, claimed_at)
  values (target_match_id, staff_session, clock_timestamp())
  on conflict (match_id) do update
  set session_id = excluded.session_id, claimed_at = excluded.claimed_at;
  update public.matches set version = version + 1, updated_at = clock_timestamp()
  where id = target_match_id returning version into next_match_version;
  next_tournament_version := private.bump_tournament();
  response := private.receipt(p_request_id, next_tournament_version, target_match_id, next_match_version);
  return private.store_mutation(staff_session, p_request_id, 'take_over', p_payload, response, target_match_id);
end;
$$;

create or replace function public.add_point(p_request_id uuid, p_expected_version integer, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  staff_session uuid; replay jsonb; current_match public.matches%rowtype;
  side text := p_payload ->> 'side'; target_match_id uuid := (p_payload ->> 'matchId')::uuid;
  next_match_version integer; next_tournament_version integer; response jsonb;
begin
  staff_session := private.require_staff_access(); perform private.lock_mutations();
  replay := private.replay_mutation(staff_session, p_request_id, 'add_point', p_payload);
  if replay is not null then return replay; end if;
  current_match := private.require_match_version(target_match_id, p_expected_version);
  perform private.require_match_owner(target_match_id, staff_session);
  if side not in ('a', 'b') or current_match.state <> 'playing'
    or private.is_winning_score(current_match.score_a, current_match.score_b) then
    raise exception 'Point cannot be added' using errcode = '55000';
  end if;
  update public.matches
  set score_a = score_a + case when side = 'a' then 1 else 0 end,
      score_b = score_b + case when side = 'b' then 1 else 0 end,
      version = version + 1, updated_at = clock_timestamp()
  where id = target_match_id returning version into next_match_version;
  next_tournament_version := private.bump_tournament();
  response := private.receipt(p_request_id, next_tournament_version, target_match_id, next_match_version);
  return private.store_mutation(staff_session, p_request_id, 'add_point', p_payload, response, target_match_id, side);
end;
$$;

create or replace function public.undo_point(p_request_id uuid, p_expected_version integer, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  staff_session uuid; replay jsonb; current_match public.matches%rowtype; point_log private.mutation_log%rowtype;
  target_match_id uuid := (p_payload ->> 'matchId')::uuid;
  next_match_version integer; next_tournament_version integer; response jsonb;
begin
  staff_session := private.require_staff_access(); perform private.lock_mutations();
  replay := private.replay_mutation(staff_session, p_request_id, 'undo_point', p_payload);
  if replay is not null then return replay; end if;
  current_match := private.require_match_version(target_match_id, p_expected_version);
  perform private.require_match_owner(target_match_id, staff_session);
  if current_match.state <> 'playing' then
    raise exception 'Only a playing match can be undone' using errcode = '55000';
  end if;
  select * into point_log from private.mutation_log as point_entry
  where point_entry.match_id = target_match_id and point_entry.operation = 'add_point' and not point_entry.undone
  order by created_at desc, request_id desc limit 1 for update;
  if not found then raise exception 'No point is available to undo' using errcode = '55000'; end if;
  if (point_log.point_side = 'a' and current_match.score_a <= 0)
    or (point_log.point_side = 'b' and current_match.score_b <= 0) then
    raise exception 'Score history is inconsistent' using errcode = '55000';
  end if;
  update public.matches
  set score_a = score_a - case when point_log.point_side = 'a' then 1 else 0 end,
      score_b = score_b - case when point_log.point_side = 'b' then 1 else 0 end,
      version = version + 1, updated_at = clock_timestamp()
  where id = target_match_id returning version into next_match_version;
  update private.mutation_log set undone = true
  where request_id = point_log.request_id and staff_session_id = point_log.staff_session_id;
  next_tournament_version := private.bump_tournament();
  response := private.receipt(p_request_id, next_tournament_version, target_match_id, next_match_version);
  return private.store_mutation(staff_session, p_request_id, 'undo_point', p_payload, response, target_match_id);
end;
$$;

create or replace function public.confirm_result(p_request_id uuid, p_expected_version integer, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  staff_session uuid; replay jsonb; current_match public.matches%rowtype;
  target_match_id uuid := (p_payload ->> 'matchId')::uuid; winner uuid;
  next_match_version integer; next_tournament_version integer; response jsonb;
begin
  staff_session := private.require_staff_access(); perform private.lock_mutations();
  replay := private.replay_mutation(staff_session, p_request_id, 'confirm_result', p_payload);
  if replay is not null then return replay; end if;
  current_match := private.require_match_version(target_match_id, p_expected_version);
  perform private.require_match_owner(target_match_id, staff_session);
  if current_match.state <> 'playing'
    or not private.is_winning_score(current_match.score_a, current_match.score_b) then
    raise exception 'Match has no winning score to confirm' using errcode = '55000';
  end if;
  winner := case when current_match.score_a > current_match.score_b
    then current_match.pair_a_id else current_match.pair_b_id end;
  update public.matches
  set state = 'completed', result_kind = 'played', winner_id = winner,
      version = version + 1, updated_at = clock_timestamp()
  where id = target_match_id returning version into next_match_version;
  delete from private.match_ownership where match_id = target_match_id;

  if current_match.round = 'semifinal' then
    update public.matches
    set pair_a_id = case when source_a_match_id = target_match_id then winner else pair_a_id end,
        pair_b_id = case when source_b_match_id = target_match_id then winner else pair_b_id end,
        updated_at = clock_timestamp()
    where round = 'final' and (source_a_match_id = target_match_id or source_b_match_id = target_match_id);
  elsif current_match.round = 'final' then
    update public.tournament set stage = 'completed' where singleton;
  end if;

  next_tournament_version := private.bump_tournament();
  response := private.receipt(p_request_id, next_tournament_version, target_match_id, next_match_version);
  return private.store_mutation(staff_session, p_request_id, 'confirm_result', p_payload, response, target_match_id);
end;
$$;

revoke all on function private.is_winning_score(integer, integer) from public, anon, authenticated, service_role;
revoke all on function private.require_match_version(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function private.require_match_owner(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.bump_tournament() from public, anon, authenticated, service_role;
revoke all on function public.start_scoring(uuid, integer, jsonb) from public, anon;
revoke all on function public.take_over(uuid, integer, jsonb) from public, anon;
revoke all on function public.add_point(uuid, integer, jsonb) from public, anon;
revoke all on function public.undo_point(uuid, integer, jsonb) from public, anon;
revoke all on function public.confirm_result(uuid, integer, jsonb) from public, anon;
grant execute on function public.start_scoring(uuid, integer, jsonb) to authenticated;
grant execute on function public.take_over(uuid, integer, jsonb) to authenticated;
grant execute on function public.add_point(uuid, integer, jsonb) to authenticated;
grant execute on function public.undo_point(uuid, integer, jsonb) to authenticated;
grant execute on function public.confirm_result(uuid, integer, jsonb) to authenticated;
