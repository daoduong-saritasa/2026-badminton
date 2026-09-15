alter table public.tournament
add column court_count smallint check (court_count in (1, 2));

update public.tournament
set court_count = 2
where court_count is null;

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
  selected_court_count smallint;
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
    or length(btrim(setup ->> 'tournamentName')) = 0
    or not (setup ? 'courtCount')
    or (setup -> 'courtCount' <> 'null'::jsonb and (setup ->> 'courtCount')::smallint not in (1, 2)) then
    raise exception 'Invalid setup payload' using errcode = '22023';
  end if;

  selected_court_count := (setup ->> 'courtCount')::smallint;
  pair_count := jsonb_array_length(setup -> 'pairs');
  select count(*) filter (where value ->> 'group' = 'A'),
         count(*) filter (where value ->> 'group' = 'B')
  into group_a_count, group_b_count
  from jsonb_array_elements(setup -> 'pairs');

  if pair_count not between 4 and 10
    or group_a_count + group_b_count <> pair_count
    or abs(group_a_count - group_b_count) > 1 then
    raise exception 'Setup requires 4 to 10 pairs split evenly between groups' using errcode = '22023';
  end if;

  select * into tournament_row from public.tournament where singleton for update;
  if not found then
    if p_expected_version is distinct from 0 then
      raise exception 'Tournament version conflict' using errcode = '40001';
    end if;
    insert into public.tournament (name, court_count)
    values (setup ->> 'tournamentName', selected_court_count)
    returning * into tournament_row;
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
      court_count = selected_court_count,
      stage = 'setup',
      version = version + 1,
      updated_at = clock_timestamp()
  where singleton
  returning version into next_version;

  response := private.receipt(p_request_id, next_version);
  return private.store_mutation(staff_session, p_request_id, 'save_setup', p_expected_version, p_payload, response);
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
  pair_count integer;
  group_a_count integer;
  group_b_count integer;
  selected record;
  second_selected record;
  has_second boolean := false;
  prior_pairs uuid[] := array[]::uuid[];
  slot integer := 1;
  semifinal_one uuid;
  semifinal_two uuid;
  next_version integer;
  response jsonb;
begin
  staff_session := private.require_staff_access();
  perform private.lock_mutations();
  replay := private.replay_mutation(staff_session, p_request_id, 'generate_fixtures', p_expected_version, p_payload);
  if replay is not null then return replay; end if;
  tournament_row := private.require_tournament_version(p_expected_version);

  if tournament_row.setup_locked_at is not null or exists (select 1 from public.matches) then
    raise exception 'Fixtures already exist or setup is locked' using errcode = '55000';
  end if;
  if tournament_row.court_count is null then
    raise exception 'Select one or two courts before generating fixtures' using errcode = '55000';
  end if;

  select count(*), count(*) filter (where group_code = 'A'), count(*) filter (where group_code = 'B')
  into pair_count, group_a_count, group_b_count
  from public.pairs;
  if pair_count not between 4 and 10 or abs(group_a_count - group_b_count) > 1 then
    raise exception 'Setup requires 4 to 10 pairs split evenly between groups' using errcode = '22023';
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
    order by ((pair_a_id = any(prior_pairs) or pair_b_id = any(prior_pairs)))::integer, candidate_id
    limit 1;

    has_second := false;
    if tournament_row.court_count = 2 then
      select * into second_selected
      from fixture_candidates
      where candidate_id <> selected.candidate_id
        and pair_a_id not in (selected.pair_a_id, selected.pair_b_id)
        and pair_b_id not in (selected.pair_a_id, selected.pair_b_id)
      order by ((pair_a_id = any(prior_pairs) or pair_b_id = any(prior_pairs)))::integer, candidate_id
      limit 1;
      has_second := found;
    end if;

    insert into public.matches (
      tournament_id, round, group_code, pair_a_id, pair_b_id, court, playing_order
    ) values (
      tournament_row.id, 'group', selected.group_code,
      selected.pair_a_id, selected.pair_b_id, 1, slot
    );

    prior_pairs := array[selected.pair_a_id, selected.pair_b_id];
    delete from fixture_candidates where candidate_id = selected.candidate_id;

    if has_second then
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
  ) values (
    tournament_row.id, 'semifinal', 'B1', 'A2',
    case when tournament_row.court_count = 2 then 2 else 1 end,
    case when tournament_row.court_count = 2 then slot else slot + 1 end
  ) returning id into semifinal_two;
  insert into public.matches (
    tournament_id, round, source_a_label, source_b_label,
    source_a_match_id, source_b_match_id, court, playing_order
  ) values (
    tournament_row.id, 'final', 'SF1 winner', 'SF2 winner', semifinal_one, semifinal_two, 1,
    case when tournament_row.court_count = 2 then slot + 1 else slot + 2 end
  );

  update public.tournament
  set stage = 'groups', version = version + 1, updated_at = clock_timestamp()
  where id = tournament_row.id
  returning version into next_version;

  response := private.receipt(p_request_id, next_version);
  return private.store_mutation(staff_session, p_request_id, 'generate_fixtures', p_expected_version, p_payload, response);
end;
$$;

create or replace function public.set_court_count(
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
  selected_court_count smallint := (p_payload ->> 'courtCount')::smallint;
  court_one_max integer;
  next_version integer;
  response jsonb;
begin
  staff_session := private.require_staff_access();
  perform private.lock_mutations();
  replay := private.replay_mutation(staff_session, p_request_id, 'set_court_count', p_expected_version, p_payload);
  if replay is not null then return replay; end if;
  tournament_row := private.require_tournament_version(p_expected_version);

  if p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or selected_court_count is null
    or selected_court_count not in (1, 2)
    or p_payload <> jsonb_build_object('courtCount', selected_court_count) then
    raise exception 'Court count must be one or two' using errcode = '22023';
  end if;

  if selected_court_count = 1 and tournament_row.court_count = 2 then
    if exists (select 1 from public.matches where court = 2 and state = 'playing') then
      raise exception 'Court 2 has an active match' using errcode = '55000';
    end if;

    select coalesce(max(playing_order), 0)
    into court_one_max
    from public.matches
    where court = 1 and state <> 'void';

    with moved as (
      select id, row_number() over (order by playing_order, id) as queue_offset
      from public.matches
      where court = 2 and state = 'unstarted'
    )
    update public.matches as match_row
    set court = 1,
        playing_order = court_one_max + moved.queue_offset,
        version = match_row.version + 1,
        updated_at = clock_timestamp()
    from moved
    where match_row.id = moved.id;
  end if;

  update public.tournament
  set court_count = selected_court_count,
      version = version + 1,
      updated_at = clock_timestamp()
  where id = tournament_row.id
  returning version into next_version;

  response := private.receipt(p_request_id, next_version);
  return private.store_mutation(staff_session, p_request_id, 'set_court_count', p_expected_version, p_payload, response);
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
  next_version integer;
  response jsonb;
begin
  staff_session := private.require_staff_access();
  perform private.lock_mutations();
  replay := private.replay_mutation(staff_session, p_request_id, 'assign_courts', p_expected_version, p_payload);
  if replay is not null then return replay; end if;
  tournament_row := private.require_tournament_version(p_expected_version);

  if jsonb_typeof(p_payload -> 'assignments') <> 'array' then
    raise exception 'Assignments must be an array' using errcode = '22023';
  end if;

  create temporary table desired_assignments (
    match_id uuid primary key,
    court smallint not null,
    playing_order integer not null,
    unique (playing_order, court)
  ) on commit drop;

  insert into desired_assignments (match_id, court, playing_order)
  select (item ->> 'matchId')::uuid, (item ->> 'court')::smallint, (item ->> 'playingOrder')::integer
  from jsonb_array_elements(p_payload -> 'assignments') as item;

  if exists (
    select 1 from desired_assignments
    where tournament_row.court_count is null
      or court not between 1 and tournament_row.court_count
      or playing_order <= 0
  ) then
    raise exception 'Invalid court assignment' using errcode = '22023';
  end if;

  if exists (
    select 1
    from desired_assignments as desired
    left join public.matches as match_row on match_row.id = desired.match_id
    where match_row.id is null or match_row.state <> 'unstarted'
  ) then
    raise exception 'Only unstarted matches can be assigned' using errcode = '55000';
  end if;

  update public.matches as match_row
  set court = null
  from desired_assignments as desired
  where match_row.id = desired.match_id;

  update public.matches as match_row
  set court = desired.court,
      playing_order = desired.playing_order,
      version = match_row.version + 1,
      updated_at = clock_timestamp()
  from desired_assignments as desired
  where match_row.id = desired.match_id;

  update public.tournament
  set version = version + 1, updated_at = clock_timestamp()
  where id = tournament_row.id
  returning version into next_version;

  response := private.receipt(p_request_id, next_version);
  return private.store_mutation(staff_session, p_request_id, 'assign_courts', p_expected_version, p_payload, response);
end;
$$;

create or replace function public.start_scoring(p_request_id uuid, p_expected_version integer, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  staff_session uuid; replay jsonb; current_match public.matches%rowtype;
  tournament_row public.tournament%rowtype;
  next_match_version integer; next_tournament_version integer; response jsonb;
  target_match_id uuid := (p_payload ->> 'matchId')::uuid;
begin
  staff_session := private.require_staff_access(); perform private.lock_mutations();
  replay := private.replay_mutation(staff_session, p_request_id, 'start_scoring', p_expected_version, p_payload);
  if replay is not null then
    perform private.require_scoring_replay(target_match_id, staff_session, replay, false);
    return replay;
  end if;
  tournament_row := private.require_tournament_version(p_expected_version);
  current_match := private.require_match_version(target_match_id, p_expected_version);
  if current_match.state <> 'unstarted' or current_match.pair_a_id is null
    or current_match.pair_b_id is null or current_match.court is null
    or tournament_row.court_count is null
    or current_match.court > tournament_row.court_count then
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
  return private.store_mutation(staff_session, p_request_id, 'start_scoring', p_expected_version, p_payload, response, target_match_id);
end;
$$;

revoke all on function public.set_court_count(uuid, integer, jsonb) from public, anon;
grant execute on function public.set_court_count(uuid, integer, jsonb) to authenticated;
