create table private.maintenance_state (
  singleton boolean primary key default true check (singleton),
  reset_enabled boolean not null default false,
  reset_generation integer not null default 0 check (reset_generation >= 0),
  updated_at timestamptz not null default now()
);

insert into private.maintenance_state (singleton) values (true);

create table public.tournament_generation (
  singleton boolean primary key default true check (singleton),
  reset_generation integer not null check (reset_generation >= 0)
);

insert into public.tournament_generation (singleton, reset_generation) values (true, 0);
alter table public.tournament_generation enable row level security;
create policy tournament_generation_public_read on public.tournament_generation
for select to anon, authenticated using (true);
grant select on public.tournament_generation to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tournament_generation'
  ) then
    alter publication supabase_realtime add table public.tournament_generation;
  end if;
end;
$$;

alter table private.mutation_log drop constraint mutation_log_pkey;
alter table private.mutation_log add column id bigint generated always as identity;
alter table private.mutation_log add primary key (id);
alter table private.mutation_log alter column staff_session_id drop not null;
alter table private.mutation_log add column actor_kind text not null default 'staff'
  check (actor_kind in ('staff', 'maintenance'));
alter table private.mutation_log add column reset_generation integer not null default 0
  check (reset_generation >= 0);
alter table private.mutation_log add column maintenance_mode text
  check (maintenance_mode in ('progress', 'all'));
alter table private.mutation_log add column target_tournament_id uuid;
alter table private.mutation_log add column target_tournament_name text;
alter table private.mutation_log add column database_role text;
alter table private.mutation_log add constraint mutation_log_actor_fields_check check (
  (actor_kind = 'staff' and staff_session_id is not null and maintenance_mode is null)
  or
  (actor_kind = 'maintenance' and staff_session_id is null and maintenance_mode is not null)
);
create unique index mutation_log_staff_request_unique
on private.mutation_log (request_id, staff_session_id)
where actor_kind = 'staff';
create unique index mutation_log_maintenance_request_unique
on private.mutation_log (request_id)
where actor_kind = 'maintenance';

create or replace function private.current_reset_generation()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select reset_generation from private.maintenance_state where singleton;
$$;

create or replace function private.require_reset_generation(p_reset_generation integer)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_reset_generation is null
    or p_reset_generation <> private.current_reset_generation() then
    raise exception 'Tournament reset generation conflict' using errcode = '40001';
  end if;
end;
$$;

create or replace function private.replay_mutation(
  p_session_id uuid,
  p_request_id uuid,
  p_operation text,
  p_expected_version integer,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  logged private.mutation_log%rowtype;
  current_generation integer := private.current_reset_generation();
  fingerprint text := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        jsonb_build_object(
          'resetGeneration', current_generation,
          'expectedVersion', p_expected_version,
          'payload', p_payload
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
begin
  select * into logged
  from private.mutation_log
  where request_id = p_request_id
    and staff_session_id = p_session_id
    and actor_kind = 'staff';

  if not found then return null; end if;
  if logged.operation <> p_operation
    or logged.reset_generation <> current_generation
    or logged.payload_fingerprint <> fingerprint then
    raise exception 'Request ID was already used with different input' using errcode = '22023';
  end if;
  return logged.response;
end;
$$;

create or replace function private.store_mutation(
  p_session_id uuid,
  p_request_id uuid,
  p_operation text,
  p_expected_version integer,
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
declare current_generation integer := private.current_reset_generation();
begin
  insert into private.mutation_log (
    request_id, staff_session_id, actor_kind, reset_generation, operation,
    payload_fingerprint, response, match_id, point_side
  ) values (
    p_request_id, p_session_id, 'staff', current_generation, p_operation,
    pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          jsonb_build_object(
            'resetGeneration', current_generation,
            'expectedVersion', p_expected_version,
            'payload', p_payload
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    p_response, p_match_id, p_point_side
  );
  return p_response;
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
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'requestId', p_request_id,
    'resetGeneration', private.current_reset_generation(),
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
    'resetGeneration', generation.reset_generation,
    'snapshot', (
      select jsonb_build_object(
        'tournament', to_jsonb(tournament_row) - 'singleton' - 'created_at' - 'updated_at',
        'players', coalesce((select jsonb_agg(to_jsonb(player_row) - 'created_at' order by player_row.id) from public.players as player_row), '[]'::jsonb),
        'pairs', coalesce((select jsonb_agg(to_jsonb(pair_row) - 'created_at' order by pair_row.id) from public.pairs as pair_row), '[]'::jsonb),
        'matches', coalesce((select jsonb_agg(to_jsonb(match_row) - 'created_at' - 'updated_at' order by match_row.playing_order, match_row.court nulls last, match_row.id) from public.matches as match_row), '[]'::jsonb),
        'tieResolutions', coalesce((select jsonb_agg(to_jsonb(tie_row) - 'created_at' - 'updated_at' order by tie_row.group_code) from public.tie_resolutions as tie_row), '[]'::jsonb)
      )
      from public.tournament as tournament_row
      where tournament_row.singleton
    )
  )
  from public.tournament_generation as generation
  where generation.singleton;
$$;

create or replace function public.set_reset_enabled(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'Reset enabled value is required' using errcode = '22023';
  end if;
  perform private.lock_mutations();
  update private.maintenance_state
  set reset_enabled = p_enabled, updated_at = clock_timestamp()
  where singleton;
end;
$$;

create or replace function public.reset_tournament(
  p_request_id uuid,
  p_expected_generation integer,
  p_expected_tournament_id uuid,
  p_expected_version integer,
  p_mode text,
  p_confirmation_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  state_row private.maintenance_state%rowtype;
  tournament_row public.tournament%rowtype;
  logged private.mutation_log%rowtype;
  next_generation integer;
  next_version integer;
  response jsonb;
  fingerprint text := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(jsonb_build_object(
        'expectedGeneration', p_expected_generation,
        'expectedTournamentId', p_expected_tournament_id,
        'expectedVersion', p_expected_version,
        'mode', p_mode,
        'confirmationName', p_confirmation_name
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  perform private.lock_mutations();

  select * into logged from private.mutation_log
  where request_id = p_request_id and actor_kind = 'maintenance';
  if found then
    if logged.operation <> 'reset_tournament' or logged.payload_fingerprint <> fingerprint then
      raise exception 'Request ID was already used with different input' using errcode = '22023';
    end if;
    return logged.response;
  end if;

  select * into strict state_row
  from private.maintenance_state where singleton for update;
  select * into tournament_row
  from public.tournament where singleton for update;

  if not found
    or p_request_id is null
    or p_mode is null
    or p_mode not in ('progress', 'all')
    or p_expected_generation is null
    or state_row.reset_generation <> p_expected_generation
    or not state_row.reset_enabled
    or tournament_row.id is distinct from p_expected_tournament_id
    or tournament_row.version is distinct from p_expected_version
    or btrim(tournament_row.name) is distinct from btrim(p_confirmation_name) then
    raise exception 'Reset target, generation, mode, or enable state is invalid' using errcode = '55000';
  end if;

  next_generation := state_row.reset_generation + 1;
  if p_mode = 'progress' then
    delete from private.match_ownership;
    delete from public.tie_resolutions where tournament_id = tournament_row.id;
    update public.pairs set withdrawn = false;
    update public.matches
    set pair_a_id = case when round = 'group' then pair_a_id else null end,
        pair_b_id = case when round = 'group' then pair_b_id else null end,
        state = 'unstarted', score_a = null, score_b = null,
        result_kind = null, winner_id = null, version = version + 1,
        updated_at = clock_timestamp()
    where tournament_id = tournament_row.id;
    update public.tournament
    set stage = 'setup', setup_locked_at = null, version = version + 1,
        updated_at = clock_timestamp()
    where id = tournament_row.id
    returning version into next_version;
  else
    delete from public.matches where tournament_id = tournament_row.id;
    delete from public.tie_resolutions where tournament_id = tournament_row.id;
    delete from public.pairs where id is not null;
    delete from public.players where id is not null;
    delete from public.tournament where id = tournament_row.id;
    next_version := 0;
  end if;

  update private.maintenance_state
  set reset_enabled = false, reset_generation = next_generation,
      updated_at = clock_timestamp()
  where singleton;
  update public.tournament_generation
  set reset_generation = next_generation
  where singleton;

  response := jsonb_build_object(
    'requestId', p_request_id,
    'resetGeneration', next_generation,
    'tournamentVersion', next_version,
    'matchId', null,
    'matchVersion', null
  );
  insert into private.mutation_log (
    request_id, staff_session_id, actor_kind, reset_generation, operation,
    payload_fingerprint, response, maintenance_mode, target_tournament_id,
    target_tournament_name, database_role
  ) values (
    p_request_id, null, 'maintenance', next_generation, 'reset_tournament',
    fingerprint, response, p_mode, tournament_row.id, tournament_row.name, auth.role()
  );
  return response;
end;
$$;

revoke all on function private.current_reset_generation() from public, anon, authenticated, service_role;
revoke all on function private.require_reset_generation(integer) from public, anon, authenticated, service_role;
revoke all on function public.set_reset_enabled(boolean) from public, anon, authenticated;
revoke all on function public.reset_tournament(uuid, integer, uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.set_reset_enabled(boolean) to service_role;
grant execute on function public.reset_tournament(uuid, integer, uuid, integer, text, text) to service_role;

alter function public.save_setup(uuid, integer, jsonb) set schema private;
alter function private.save_setup(uuid, integer, jsonb) rename to legacy_save_setup;
alter function public.set_court_count(uuid, integer, jsonb) set schema private;
alter function private.set_court_count(uuid, integer, jsonb) rename to legacy_set_court_count;
alter function public.generate_fixtures(uuid, integer, jsonb) set schema private;
alter function private.generate_fixtures(uuid, integer, jsonb) rename to legacy_generate_fixtures;
alter function public.assign_courts(uuid, integer, jsonb) set schema private;
alter function private.assign_courts(uuid, integer, jsonb) rename to legacy_assign_courts;
alter function public.start_scoring(uuid, integer, jsonb) set schema private;
alter function private.start_scoring(uuid, integer, jsonb) rename to legacy_start_scoring;
alter function public.take_over(uuid, integer, jsonb) set schema private;
alter function private.take_over(uuid, integer, jsonb) rename to legacy_take_over;
alter function public.add_point(uuid, integer, jsonb) set schema private;
alter function private.add_point(uuid, integer, jsonb) rename to legacy_add_point;
alter function public.undo_point(uuid, integer, jsonb) set schema private;
alter function private.undo_point(uuid, integer, jsonb) rename to legacy_undo_point;
alter function public.confirm_result(uuid, integer, jsonb) set schema private;
alter function private.confirm_result(uuid, integer, jsonb) rename to legacy_confirm_result;
alter function public.enter_result(uuid, integer, jsonb) set schema private;
alter function private.enter_result(uuid, integer, jsonb) rename to legacy_enter_result;
alter function public.correct_result(uuid, integer, jsonb) set schema private;
alter function private.correct_result(uuid, integer, jsonb) rename to legacy_correct_result;
alter function public.mark_walkover(uuid, integer, jsonb) set schema private;
alter function private.mark_walkover(uuid, integer, jsonb) rename to legacy_mark_walkover;
alter function public.withdraw_pair(uuid, integer, jsonb) set schema private;
alter function private.withdraw_pair(uuid, integer, jsonb) rename to legacy_withdraw_pair;
alter function public.resolve_tie(uuid, integer, jsonb) set schema private;
alter function private.resolve_tie(uuid, integer, jsonb) rename to legacy_resolve_tie;
alter function public.confirm_groups(uuid, integer, jsonb) set schema private;
alter function private.confirm_groups(uuid, integer, jsonb) rename to legacy_confirm_groups;
alter function public.reopen_tournament(uuid, integer, jsonb) set schema private;
alter function private.reopen_tournament(uuid, integer, jsonb) rename to legacy_reopen_tournament;

create or replace function private.legacy_undo_point(
  p_request_id uuid,
  p_expected_version integer,
  p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  staff_session uuid; replay jsonb; current_match public.matches%rowtype;
  point_log private.mutation_log%rowtype;
  target_match_id uuid := (p_payload ->> 'matchId')::uuid;
  current_generation integer := private.current_reset_generation();
  next_match_version integer; next_tournament_version integer; response jsonb;
begin
  staff_session := private.require_staff_access(); perform private.lock_mutations();
  replay := private.replay_mutation(staff_session, p_request_id, 'undo_point', p_expected_version, p_payload);
  if replay is not null then
    perform private.require_scoring_replay(target_match_id, staff_session, replay, false);
    return replay;
  end if;
  current_match := private.require_match_version(target_match_id, p_expected_version);
  perform private.require_match_owner(target_match_id, staff_session);
  if current_match.state <> 'playing' then
    raise exception 'Only a playing match can be undone' using errcode = '55000';
  end if;
  select * into point_log from private.mutation_log as point_entry
  where point_entry.match_id = target_match_id
    and point_entry.operation = 'add_point'
    and point_entry.actor_kind = 'staff'
    and point_entry.reset_generation = current_generation
    and not point_entry.undone
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
  update private.mutation_log set undone = true where id = point_log.id;
  next_tournament_version := private.bump_tournament();
  response := private.receipt(p_request_id, next_tournament_version, target_match_id, next_match_version);
  return private.store_mutation(staff_session, p_request_id, 'undo_point', p_expected_version, p_payload, response, target_match_id);
end;
$$;

create or replace function private.invoke_legacy_mutation(
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
declare response jsonb;
begin
  perform private.require_staff_access();
  perform private.lock_mutations();
  perform private.require_reset_generation(p_reset_generation);
  if p_operation not in (
    'save_setup', 'set_court_count', 'generate_fixtures', 'assign_courts',
    'start_scoring', 'take_over', 'add_point', 'undo_point', 'confirm_result',
    'enter_result', 'correct_result', 'mark_walkover', 'withdraw_pair',
    'resolve_tie', 'confirm_groups', 'reopen_tournament'
  ) then
    raise exception 'Unknown tournament mutation' using errcode = '22023';
  end if;
  execute format('select private.%I($1, $2, $3)', 'legacy_' || p_operation)
  into response using p_request_id, p_expected_version, p_payload;
  return response;
end;
$$;

create or replace function public.save_setup(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_legacy_mutation('save_setup', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create or replace function public.set_court_count(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_legacy_mutation('set_court_count', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create or replace function public.generate_fixtures(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_legacy_mutation('generate_fixtures', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create or replace function public.assign_courts(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_legacy_mutation('assign_courts', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create or replace function public.start_scoring(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_legacy_mutation('start_scoring', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create or replace function public.take_over(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_legacy_mutation('take_over', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create or replace function public.add_point(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_legacy_mutation('add_point', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create or replace function public.undo_point(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_legacy_mutation('undo_point', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create or replace function public.confirm_result(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_legacy_mutation('confirm_result', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create or replace function public.enter_result(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_legacy_mutation('enter_result', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create or replace function public.correct_result(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_legacy_mutation('correct_result', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create or replace function public.mark_walkover(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_legacy_mutation('mark_walkover', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create or replace function public.withdraw_pair(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_legacy_mutation('withdraw_pair', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create or replace function public.resolve_tie(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_legacy_mutation('resolve_tie', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create or replace function public.confirm_groups(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_legacy_mutation('confirm_groups', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create or replace function public.reopen_tournament(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_legacy_mutation('reopen_tournament', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;

revoke all on function private.invoke_legacy_mutation(text, uuid, integer, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.legacy_save_setup(uuid, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.legacy_set_court_count(uuid, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.legacy_generate_fixtures(uuid, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.legacy_assign_courts(uuid, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.legacy_start_scoring(uuid, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.legacy_take_over(uuid, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.legacy_add_point(uuid, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.legacy_undo_point(uuid, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.legacy_confirm_result(uuid, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.legacy_enter_result(uuid, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.legacy_correct_result(uuid, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.legacy_mark_walkover(uuid, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.legacy_withdraw_pair(uuid, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.legacy_resolve_tie(uuid, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.legacy_confirm_groups(uuid, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.legacy_reopen_tournament(uuid, integer, jsonb) from public, anon, authenticated, service_role;

revoke all on function
  public.save_setup(uuid, integer, integer, jsonb),
  public.set_court_count(uuid, integer, integer, jsonb),
  public.generate_fixtures(uuid, integer, integer, jsonb),
  public.assign_courts(uuid, integer, integer, jsonb),
  public.start_scoring(uuid, integer, integer, jsonb),
  public.take_over(uuid, integer, integer, jsonb),
  public.add_point(uuid, integer, integer, jsonb),
  public.undo_point(uuid, integer, integer, jsonb),
  public.confirm_result(uuid, integer, integer, jsonb),
  public.enter_result(uuid, integer, integer, jsonb),
  public.correct_result(uuid, integer, integer, jsonb),
  public.mark_walkover(uuid, integer, integer, jsonb),
  public.withdraw_pair(uuid, integer, integer, jsonb),
  public.resolve_tie(uuid, integer, integer, jsonb),
  public.confirm_groups(uuid, integer, integer, jsonb),
  public.reopen_tournament(uuid, integer, integer, jsonb)
from public, anon;

grant execute on function public.save_setup(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.set_court_count(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.generate_fixtures(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.assign_courts(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.start_scoring(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.take_over(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.add_point(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.undo_point(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.confirm_result(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.enter_result(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.correct_result(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.mark_walkover(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.withdraw_pair(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.resolve_tie(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.confirm_groups(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.reopen_tournament(uuid, integer, integer, jsonb) to authenticated;
