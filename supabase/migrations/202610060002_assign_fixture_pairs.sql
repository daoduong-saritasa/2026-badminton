-- Staff save every pair of a fixture in one command. The per-side checks move
-- into private.set_match_pair so assign_pair and assign_fixture_pairs enforce
-- the same rules.

-- Validates one side's pair on a locked, unstarted match and saves it.
-- Returns the match's new version.
create or replace function private.set_match_pair(
  p_match_id uuid,
  p_side text,
  p_player_1 uuid,
  p_player_2 uuid,
  p_rule_exception boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_match public.matches%rowtype;
  fixture public.team_fixtures%rowtype;
  tournament_row public.tournament%rowtype;
  target_team uuid;
  next_match_version integer;
begin
  if p_side is null or p_side not in ('a', 'b')
    or p_player_1 is null or p_player_2 is null then
    raise exception 'Invalid pair assignment' using errcode = '22023';
  end if;

  select * into strict target_match from public.matches where id = p_match_id;
  select * into strict fixture
  from public.team_fixtures where id = target_match.fixture_id;
  select * into strict tournament_row
  from public.tournament where id = fixture.tournament_id;

  if target_match.state <> 'unstarted' then
    raise exception 'Pairs are fixed after the match starts' using errcode = '55000';
  end if;
  target_team := case when p_side = 'a' then fixture.team_a_id else fixture.team_b_id end;
  if tournament_row.stage = 'setup' or target_team is null
    or (fixture.stage in ('third-place', 'final')
      and tournament_row.finalists_confirmed_at is null) then
    raise exception 'Pair assignment is not open for this match' using errcode = '55000';
  end if;

  if p_player_1 = p_player_2 then
    raise exception 'A pair requires two distinct players' using errcode = '22023';
  end if;
  if (select count(*) from public.players
      where team_id = target_team and id in (p_player_1, p_player_2)) <> 2 then
    raise exception 'Pair players must belong to the team' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.matches as playing
    where playing.state = 'playing'
      and array[
        playing.pair_a_player_1_id, playing.pair_a_player_2_id,
        playing.pair_b_player_1_id, playing.pair_b_player_2_id
      ] && array[p_player_1, p_player_2]
  ) then
    raise exception 'A player is already playing' using errcode = '55000';
  end if;

  if not p_rule_exception then
    if (fixture.stage = 'qualifying'
        or (fixture.stage = 'third-place' and target_match.match_number < 3))
      and (select count(distinct seed) from public.players
           where id in (p_player_1, p_player_2)) <> 2 then
      raise exception 'Pair must mix seeds' using errcode = '22023';
    end if;
    if fixture.stage = 'qualifying' and exists (
      select 1 from public.matches as sibling
      where sibling.fixture_id = fixture.id
        and sibling.id <> target_match.id
        and (case when p_side = 'a'
          then array[sibling.pair_a_player_1_id, sibling.pair_a_player_2_id]
          else array[sibling.pair_b_player_1_id, sibling.pair_b_player_2_id]
        end) && array[p_player_1, p_player_2]
    ) then
      raise exception 'Player already plays in this fixture' using errcode = '22023';
    end if;
  end if;

  update public.matches as match
  set pair_a_player_1_id = case when p_side = 'a' then p_player_1 else match.pair_a_player_1_id end,
      pair_a_player_2_id = case when p_side = 'a' then p_player_2 else match.pair_a_player_2_id end,
      pair_b_player_1_id = case when p_side = 'b' then p_player_1 else match.pair_b_player_1_id end,
      pair_b_player_2_id = case when p_side = 'b' then p_player_2 else match.pair_b_player_2_id end,
      version = match.version + 1,
      updated_at = clock_timestamp()
  where match.id = target_match.id
  returning match.version into next_match_version;
  return next_match_version;
end;
$$;

revoke all on function private.set_match_pair(uuid, text, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;

create or replace function private.team_assign_pair(
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
  rule_exception boolean := coalesce((p_payload ->> 'ruleException')::boolean, false);
  next_match_version integer;
begin
  if rule_exception and private.staff_role() is distinct from 'organizer' then
    raise exception 'Organizer access required' using errcode = '42501';
  end if;
  select * into strict target_match
  from public.matches
  where id = (p_payload ->> 'matchId')::uuid
  for update;
  if target_match.version <> p_expected_version then
    raise exception 'Match version conflict' using errcode = '40001';
  end if;

  next_match_version := private.set_match_pair(
    target_match.id,
    p_payload ->> 'side',
    (p_payload ->> 'player1Id')::uuid,
    (p_payload ->> 'player2Id')::uuid,
    rule_exception
  );
  return private.receipt(
    p_request_id, private.bump_team_tournament(), target_match.id, next_match_version
  );
end;
$$;

-- Saves up to six pairs of one fixture atomically. Expects the fixture's
-- version; each assignment carries its match's version. Sides being replaced
-- are cleared before any pair is checked, so swapping arrangements never
-- conflicts with the pairs it replaces.
create or replace function private.team_assign_fixture_pairs(
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
  fixture public.team_fixtures%rowtype;
  assignment jsonb;
  assignments jsonb := p_payload -> 'assignments';
  rule_exception boolean := coalesce((p_payload ->> 'ruleException')::boolean, false);
  target_match public.matches%rowtype;
begin
  if rule_exception and private.staff_role() is distinct from 'organizer' then
    raise exception 'Organizer access required' using errcode = '42501';
  end if;
  if jsonb_typeof(assignments) is distinct from 'array'
    or jsonb_array_length(assignments) not between 1 and 6
    or (select count(distinct (value ->> 'matchId') || ':' || (value ->> 'side'))
        from jsonb_array_elements(assignments)) <> jsonb_array_length(assignments) then
    raise exception 'Invalid pair assignment' using errcode = '22023';
  end if;

  select * into fixture
  from public.team_fixtures
  where id = (p_payload ->> 'fixtureId')::uuid
  for update;
  if not found then
    raise exception 'Invalid pair assignment' using errcode = '22023';
  end if;
  if fixture.version <> p_expected_version then
    raise exception 'Fixture version conflict' using errcode = '40001';
  end if;

  for assignment in select value from jsonb_array_elements(assignments)
  loop
    select * into target_match
    from public.matches
    where id = (assignment ->> 'matchId')::uuid
    for update;
    if not found or target_match.fixture_id <> fixture.id then
      raise exception 'Invalid pair assignment' using errcode = '22023';
    end if;
    if target_match.version <> (assignment ->> 'matchVersion')::integer then
      raise exception 'Match version conflict' using errcode = '40001';
    end if;
    if target_match.state <> 'unstarted' then
      raise exception 'Pairs are fixed after the match starts' using errcode = '55000';
    end if;
  end loop;

  update public.matches as match
  set pair_a_player_1_id = case when cleared.side_a then null else match.pair_a_player_1_id end,
      pair_a_player_2_id = case when cleared.side_a then null else match.pair_a_player_2_id end,
      pair_b_player_1_id = case when cleared.side_b then null else match.pair_b_player_1_id end,
      pair_b_player_2_id = case when cleared.side_b then null else match.pair_b_player_2_id end
  from (
    select (value ->> 'matchId')::uuid as match_id,
           bool_or(value ->> 'side' = 'a') as side_a,
           bool_or(value ->> 'side' = 'b') as side_b
    from jsonb_array_elements(assignments)
    group by 1
  ) as cleared
  where match.id = cleared.match_id;

  for assignment in select value from jsonb_array_elements(assignments)
  loop
    perform private.set_match_pair(
      (assignment ->> 'matchId')::uuid,
      assignment ->> 'side',
      (assignment ->> 'player1Id')::uuid,
      (assignment ->> 'player2Id')::uuid,
      rule_exception
    );
  end loop;

  return private.receipt(p_request_id, private.bump_team_tournament());
end;
$$;

revoke all on function private.team_assign_fixture_pairs(uuid, integer, jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.invoke_team_mutation(
  p_operation text,
  p_request_id uuid,
  p_reset_generation integer,
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
  response jsonb;
  target_match_id uuid := case when p_payload ? 'matchId' then (p_payload ->> 'matchId')::uuid else null end;
begin
  if p_operation in (
    'assign_pair', 'assign_fixture_pairs', 'start_match', 'take_over', 'add_point',
    'undo_point', 'confirm_game'
  ) then
    staff_session := private.require_scorer();
  else
    staff_session := private.require_organizer();
  end if;
  perform private.lock_mutations();
  perform private.require_reset_generation(p_reset_generation);
  replay := private.replay_mutation(
    staff_session, p_request_id, p_operation, p_expected_version, p_payload
  );
  if replay is not null then return replay; end if;

  response := case p_operation
    when 'save_roster' then private.team_save_roster(p_request_id, p_expected_version, p_payload)
    when 'start_qualifying' then private.team_start_qualifying(p_request_id, p_expected_version, p_payload)
    when 'assign_courts' then private.team_assign_courts(p_request_id, p_expected_version, p_payload)
    when 'assign_pair' then private.team_assign_pair(p_request_id, p_expected_version, p_payload)
    when 'assign_fixture_pairs' then private.team_assign_fixture_pairs(p_request_id, p_expected_version, p_payload)
    when 'start_match' then private.team_start_match(staff_session, p_request_id, p_expected_version, p_payload)
    when 'take_over' then private.team_take_over(staff_session, p_request_id, p_expected_version, p_payload)
    when 'add_point' then private.team_add_point(staff_session, p_request_id, p_expected_version, p_payload)
    when 'undo_point' then private.team_undo_point(staff_session, p_request_id, p_expected_version, p_payload)
    when 'confirm_game' then private.team_confirm_game(staff_session, p_request_id, p_expected_version, p_payload)
    when 'mark_walkover' then private.team_mark_walkover(p_request_id, p_expected_version, p_payload)
    when 'correct_result' then private.team_correct_result(p_request_id, p_expected_version, p_payload)
    when 'record_draw' then private.team_record_draw(p_request_id, p_expected_version, p_payload)
    when 'confirm_finalists' then private.team_confirm_finalists(p_request_id, p_expected_version, p_payload)
    else null
  end;
  if response is null then
    raise exception 'Unknown tournament mutation' using errcode = '22023';
  end if;
  return private.store_mutation(
    staff_session, p_request_id, p_operation, p_expected_version, p_payload,
    response, target_match_id,
    case when p_operation = 'add_point' then p_payload ->> 'side' else null end
  );
end;
$$;

create or replace function public.assign_fixture_pairs(
  p_request_id uuid, p_reset_generation integer,
  p_expected_version integer, p_payload jsonb
) returns jsonb language sql security definer set search_path = '' as $$
  select private.invoke_team_mutation(
    'assign_fixture_pairs', p_request_id, p_reset_generation, p_expected_version, p_payload
  );
$$;
revoke all on function public.assign_fixture_pairs(uuid, integer, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.assign_fixture_pairs(uuid, integer, integer, jsonb)
  to authenticated;
