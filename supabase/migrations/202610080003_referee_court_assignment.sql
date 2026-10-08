-- Referees may move unstarted matches between courts.

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
    'assign_courts', 'assign_pair', 'assign_fixture_pairs', 'start_match',
    'take_over', 'add_point', 'undo_point', 'confirm_game'
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
