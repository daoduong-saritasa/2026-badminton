-- Phase 3: authoritative, read-only previews for result corrections and
-- withdrawals.
--
-- The projection deliberately executes the real mutation inside a
-- subtransaction and rolls it back, rather than re-deriving standings and
-- knockout progression a second time. A parallel projection would be a second
-- source of truth that drifts from the write path; this cannot. PL/pgSQL
-- variables survive the rollback, so the projected snapshot is captured before
-- the subtransaction unwinds and nothing reaches the mutation log, the
-- tournament version, or any table.

-- Shared snapshot projection ------------------------------------------------

create or replace function private.snapshot_body()
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

create or replace function public.get_tournament_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'resetGeneration', generation.reset_generation,
    'snapshot', private.snapshot_body()
  )
  from public.tournament_generation as generation
  where generation.singleton;
$$;

-- Shared block rules ---------------------------------------------------------
-- Both the preview and the write path read the block reason from these two
-- functions, so a reason shown in the UI is the reason the server enforces.

create or replace function private.correction_block_code(
  p_match public.matches,
  p_new_winner uuid,
  p_allow_completed boolean
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_match.pair_a_id is null or p_match.pair_b_id is null
    or (not p_allow_completed and p_match.state <> 'unstarted')
    or (p_allow_completed and p_match.state <> 'completed') then
    return 'invalid-match-state';
  end if;

  -- Group results are frozen once any knockout match has left 'unstarted',
  -- including a correction that leaves the same winner.
  if p_match.round = 'group' and exists (
    select 1 from public.matches where round <> 'group' and state <> 'unstarted'
  ) then
    return 'knockouts-started';
  end if;

  if p_match.winner_id is not distinct from p_new_winner then
    return null;
  end if;

  if p_match.round = 'semifinal' and exists (
    select 1 from public.matches
    where round = 'final' and state <> 'unstarted'
      and (source_a_match_id = p_match.id or source_b_match_id = p_match.id)
  ) then
    return 'final-started';
  end if;

  return null;
end;
$$;

create or replace function private.withdrawal_block_code(p_pair_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_group text;
begin
  select group_code into target_group
  from public.pairs where id = p_pair_id and not withdrawn;
  if not found then
    raise exception 'Active pair not found' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.matches where round <> 'group' and state <> 'unstarted') then
    return 'knockouts-started';
  end if;

  if (
    select count(*) from public.pairs
    where group_code = target_group and not withdrawn and id <> p_pair_id
  ) < 2 then
    return 'too-few-active-pairs';
  end if;

  return null;
end;
$$;

create or replace function private.assert_correction_safe(
  p_match public.matches,
  p_new_winner uuid
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  block_code text;
begin
  -- The match-state arm is checked by the caller against its own
  -- allow-completed rule; only the downstream-play arms are re-raised here.
  block_code := private.correction_block_code(
    p_match, p_new_winner, p_match.state = 'completed'
  );
  if block_code = 'knockouts-started' then
    raise exception 'Knockout play already depends on group participants' using errcode = '55000';
  elsif block_code = 'final-started' then
    raise exception 'Final play already depends on this semifinal' using errcode = '55000';
  end if;
end;
$$;

-- Preview-version handshake --------------------------------------------------

create or replace function private.require_preview_version(
  p_payload jsonb,
  p_tournament_version integer
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  preview_version integer := (p_payload ->> 'previewTournamentVersion')::integer;
begin
  if preview_version is null then
    raise exception 'A reviewed preview is required for this change' using errcode = '22023';
  end if;
  if preview_version <> p_tournament_version then
    raise exception 'Tournament changed since the preview' using errcode = '40001';
  end if;
end;
$$;

-- Read-only projection -------------------------------------------------------

create or replace function private.project_mutation(
  p_operation text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  projected jsonb;
  current_version integer;
  expected_version integer;
begin
  select version into current_version from public.tournament where singleton;
  if not found then
    raise exception 'Tournament is not configured' using errcode = 'P0002';
  end if;

  -- Match-scoped mutations validate the target match's version; tournament-scoped
  -- ones validate the tournament's. Passing the wrong one raises a version
  -- conflict instead of projecting.
  if p_operation in ('enter_result', 'correct_result', 'mark_walkover') then
    select version into expected_version
    from public.matches where id = (p_payload ->> 'matchId')::uuid;
    if not found then
      raise exception 'Match not found' using errcode = 'P0002';
    end if;
  else
    expected_version := current_version;
  end if;

  begin
    execute format('select private.%I($1, $2, $3)', 'legacy_' || p_operation)
    using
      gen_random_uuid(),
      expected_version,
      p_payload || jsonb_build_object('previewTournamentVersion', current_version);
    projected := private.snapshot_body();
    -- Unwind every write the call just made. PV001 is used by nothing else, so
    -- a genuine failure inside the mutation propagates instead of being read as
    -- a successful projection.
    raise exception 'preview rollback' using errcode = 'PV001';
  exception when sqlstate 'PV001' then
    null;
  end;

  return projected;
end;
$$;

create or replace function private.impact(
  p_tournament_version integer,
  p_block_code text,
  p_before jsonb,
  p_after jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'resetGeneration', private.current_reset_generation(),
    'tournamentVersion', p_tournament_version,
    'blockedReason', p_block_code,
    'before', p_before,
    'after', case when p_block_code is null then p_after else null end
  );
$$;

-- Public preview API ---------------------------------------------------------

create or replace function public.preview_result_correction(
  p_match_id uuid,
  p_score jsonb,
  p_reset_generation integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_match public.matches%rowtype;
  current_version integer;
  allow_completed boolean;
  new_score_a integer := (p_score ->> 'a')::integer;
  new_score_b integer := (p_score ->> 'b')::integer;
  new_winner uuid;
  block_code text;
  before_body jsonb;
begin
  perform private.require_staff_access();
  perform private.require_reset_generation(p_reset_generation);

  select version into current_version from public.tournament where singleton;
  if not found then
    raise exception 'Tournament is not configured' using errcode = 'P0002';
  end if;

  select * into current_match from public.matches where id = p_match_id;
  if not found then
    raise exception 'Match not found' using errcode = 'P0002';
  end if;

  if not private.is_winning_score(new_score_a, new_score_b) then
    raise exception 'Invalid completed score' using errcode = '22023';
  end if;

  allow_completed := current_match.state = 'completed';
  new_winner := case when new_score_a > new_score_b
    then current_match.pair_a_id else current_match.pair_b_id end;

  block_code := private.correction_block_code(current_match, new_winner, allow_completed);
  before_body := private.snapshot_body();

  return private.impact(
    current_version,
    block_code,
    before_body,
    case when block_code is null then private.project_mutation(
      case when allow_completed then 'correct_result' else 'enter_result' end,
      jsonb_build_object('matchId', p_match_id, 'score', p_score)
    ) end
  );
end;
$$;

create or replace function public.preview_withdrawal(
  p_pair_id uuid,
  p_reset_generation integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_version integer;
  block_code text;
  before_body jsonb;
begin
  perform private.require_staff_access();
  perform private.require_reset_generation(p_reset_generation);

  select version into current_version from public.tournament where singleton;
  if not found then
    raise exception 'Tournament is not configured' using errcode = 'P0002';
  end if;

  block_code := private.withdrawal_block_code(p_pair_id);
  before_body := private.snapshot_body();

  return private.impact(
    current_version,
    block_code,
    before_body,
    case when block_code is null then private.project_mutation(
      'withdraw_pair',
      jsonb_build_object('pairId', p_pair_id)
    ) end
  );
end;
$$;

revoke all on function private.snapshot_body() from public, anon, authenticated, service_role;
revoke all on function private.correction_block_code(public.matches, uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function private.withdrawal_block_code(uuid) from public, anon, authenticated, service_role;
revoke all on function private.require_preview_version(jsonb, integer) from public, anon, authenticated, service_role;
revoke all on function private.project_mutation(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.impact(integer, text, jsonb, jsonb) from public, anon, authenticated, service_role;

revoke all on function public.preview_result_correction(uuid, jsonb, integer) from public, anon, authenticated, service_role;
revoke all on function public.preview_withdrawal(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.preview_result_correction(uuid, jsonb, integer) to authenticated;
grant execute on function public.preview_withdrawal(uuid, integer) to authenticated;

-- Write paths ----------------------------------------------------------------
-- Corrections and withdrawals now require the tournament version the staff
-- member actually reviewed, rechecked here under the mutation lock. Direct
-- entry on an unstarted match and walkovers keep their previous payloads.

create or replace function private.finish_direct_result(
  p_operation text,
  p_request_id uuid,
  p_expected_version integer,
  p_payload jsonb,
  p_allow_completed boolean,
  p_walkover boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  staff_session uuid; replay jsonb; current_match public.matches%rowtype;
  target_match_id uuid := (p_payload ->> 'matchId')::uuid;
  new_score_a integer; new_score_b integer; new_winner uuid;
  current_tournament_version integer;
  next_match_version integer; next_tournament_version integer; response jsonb;
begin
  staff_session := private.require_staff_access(); perform private.lock_mutations();
  replay := private.replay_mutation(staff_session, p_request_id, p_operation, p_expected_version, p_payload);
  if replay is not null then return replay; end if;
  -- p_expected_version is this match's version. The reviewed preview describes a
  -- tournament version, which is a different counter, so it is read here under
  -- the mutation lock and compared against itself.
  if p_operation = 'correct_result' then
    select version into current_tournament_version from public.tournament where singleton for update;
    if not found then
      raise exception 'Tournament is not configured' using errcode = 'P0002';
    end if;
    perform private.require_preview_version(p_payload, current_tournament_version);
  end if;
  current_match := private.require_match_version(target_match_id, p_expected_version);
  if current_match.pair_a_id is null or current_match.pair_b_id is null
    or (not p_allow_completed and current_match.state <> 'unstarted')
    or (p_allow_completed and current_match.state <> 'completed') then
    raise exception 'Match state does not allow this result' using errcode = '55000';
  end if;

  if p_walkover then
    new_winner := (p_payload ->> 'winnerId')::uuid;
    if new_winner not in (current_match.pair_a_id, current_match.pair_b_id) then
      raise exception 'Walkover winner must be a participant' using errcode = '22023';
    end if;
  else
    new_score_a := (p_payload -> 'score' ->> 'a')::integer;
    new_score_b := (p_payload -> 'score' ->> 'b')::integer;
    if not private.is_winning_score(new_score_a, new_score_b) then
      raise exception 'Invalid completed score' using errcode = '22023';
    end if;
    new_winner := case when new_score_a > new_score_b
      then current_match.pair_a_id else current_match.pair_b_id end;
  end if;

  perform private.assert_correction_safe(current_match, new_winner);
  update public.tournament
  set setup_locked_at = coalesce(setup_locked_at, clock_timestamp()),
      updated_at = clock_timestamp()
  where singleton;
  update public.matches
  set state = 'completed', score_a = case when p_walkover then null else new_score_a end,
      score_b = case when p_walkover then null else new_score_b end,
      result_kind = case when p_walkover then 'walkover' else 'played' end,
      winner_id = new_winner, version = version + 1, updated_at = clock_timestamp()
  where id = target_match_id returning version into next_match_version;
  delete from private.match_ownership where match_id = target_match_id;
  if current_match.round = 'group' then
    perform private.invalidate_group_resolution(current_match.group_code);
  elsif current_match.round = 'semifinal' then
    update public.matches
    set pair_a_id = case when source_a_match_id = target_match_id then new_winner else pair_a_id end,
        pair_b_id = case when source_b_match_id = target_match_id then new_winner else pair_b_id end,
        version = version + 1,
        updated_at = clock_timestamp()
    where round = 'final' and (source_a_match_id = target_match_id or source_b_match_id = target_match_id);
  elsif current_match.round = 'final' then
    update public.tournament set stage = 'completed' where singleton;
  end if;
  next_tournament_version := private.bump_tournament();
  response := private.receipt(p_request_id, next_tournament_version, target_match_id, next_match_version);
  return private.store_mutation(staff_session, p_request_id, p_operation, p_expected_version, p_payload, response, target_match_id);
end;
$$;

create or replace function private.legacy_withdraw_pair(
  p_request_id uuid,
  p_expected_version integer,
  p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  staff_session uuid; replay jsonb; tournament_row public.tournament%rowtype;
  target_pair_id uuid := (p_payload ->> 'pairId')::uuid; target_group text;
  block_code text; next_version integer; response jsonb;
begin
  staff_session := private.require_staff_access(); perform private.lock_mutations();
  replay := private.replay_mutation(staff_session, p_request_id, 'withdraw_pair', p_expected_version, p_payload);
  if replay is not null then return replay; end if;
  perform private.require_preview_version(p_payload, p_expected_version);
  tournament_row := private.require_tournament_version(p_expected_version);

  block_code := private.withdrawal_block_code(target_pair_id);
  if block_code = 'knockouts-started' then
    raise exception 'Pair cannot withdraw after knockout play starts' using errcode = '55000';
  elsif block_code = 'too-few-active-pairs' then
    raise exception 'Each group must retain at least two active pairs' using errcode = '55000';
  end if;

  update public.pairs set withdrawn = true
  where id = target_pair_id and not withdrawn returning group_code into target_group;
  if not found then raise exception 'Active pair not found' using errcode = 'P0002'; end if;

  delete from private.match_ownership where match_id in (
    select id from public.matches where round = 'group'
      and target_pair_id in (pair_a_id, pair_b_id)
  );
  update public.matches
  set state = 'void', score_a = null, score_b = null, result_kind = null,
      winner_id = null, version = version + 1, updated_at = clock_timestamp()
  where round = 'group' and target_pair_id in (pair_a_id, pair_b_id);
  perform private.invalidate_group_resolution(target_group);
  next_version := private.bump_tournament();
  response := private.receipt(p_request_id, next_version);
  return private.store_mutation(staff_session, p_request_id, 'withdraw_pair', p_expected_version, p_payload, response);
end;
$$;

revoke all on function private.legacy_withdraw_pair(uuid, integer, jsonb) from public, anon, authenticated, service_role;
