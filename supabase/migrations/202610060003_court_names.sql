-- Organizers name the two courts. Matches still store courts as 1 and 2;
-- the names only change what the app displays.

alter table public.tournament
  add column court_names text[] not null default array['Sân 1', 'Sân 2'];
alter table public.tournament
  add constraint tournament_court_names_check check (
    cardinality(court_names) = 2
    and court_names[1] is not null
    and court_names[2] is not null
    and length(btrim(court_names[1])) between 1 and 30
    and length(btrim(court_names[2])) between 1 and 30
    and lower(btrim(court_names[1])) <> lower(btrim(court_names[2]))
  );

-- Renames both courts; expects the tournament version. Names are trimmed and
-- must differ ignoring case. Result revision is untouched, so open result
-- previews stay valid.
create function private.team_rename_courts(
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
  names jsonb := p_payload -> 'names';
  first_name text;
  second_name text;
begin
  select * into strict tournament_row
  from public.tournament where singleton for update;
  if tournament_row.version <> p_expected_version then
    raise exception 'Tournament version conflict' using errcode = '40001';
  end if;
  if jsonb_typeof(names) is distinct from 'array' or jsonb_array_length(names) <> 2
    or jsonb_typeof(names -> 0) is distinct from 'string'
    or jsonb_typeof(names -> 1) is distinct from 'string' then
    raise exception 'Court names must be two distinct names of 1 to 30 characters'
      using errcode = '22023';
  end if;
  first_name := btrim(names ->> 0);
  second_name := btrim(names ->> 1);
  if length(first_name) not between 1 and 30 or length(second_name) not between 1 and 30
    or lower(first_name) = lower(second_name) then
    raise exception 'Court names must be two distinct names of 1 to 30 characters'
      using errcode = '22023';
  end if;

  update public.tournament
  set court_names = array[first_name, second_name]
  where id = tournament_row.id;
  return private.receipt(p_request_id, private.bump_team_tournament(true));
end;
$$;

revoke all on function private.team_rename_courts(uuid, integer, jsonb)
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
    when 'rename_courts' then private.team_rename_courts(p_request_id, p_expected_version, p_payload)
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

create function public.rename_courts(
  p_request_id uuid, p_reset_generation integer,
  p_expected_version integer, p_payload jsonb
) returns jsonb language sql security definer set search_path = '' as $$
  select private.invoke_team_mutation(
    'rename_courts', p_request_id, p_reset_generation, p_expected_version, p_payload
  );
$$;
revoke all on function public.rename_courts(uuid, integer, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.rename_courts(uuid, integer, integer, jsonb)
  to authenticated;
