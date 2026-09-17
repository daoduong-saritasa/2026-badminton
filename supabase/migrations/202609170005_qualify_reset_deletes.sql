-- Hosted Supabase runs pg_safeupdate, which rejects DELETE without a WHERE
-- clause. 202609170002 recreated reset_tournament with unqualified deletes, so
-- every maintenance reset failed on hosted.

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
  select * into strict state_row from private.maintenance_state where singleton for update;
  select * into tournament_row from public.tournament where singleton for update;
  if not found or p_request_id is null or p_mode not in ('progress', 'all')
    or state_row.reset_generation <> p_expected_generation or not state_row.reset_enabled
    or tournament_row.id is distinct from p_expected_tournament_id
    or tournament_row.version is distinct from p_expected_version
    or btrim(tournament_row.name) is distinct from btrim(p_confirmation_name) then
    raise exception 'Reset target, generation, mode, or enable state is invalid' using errcode = '55000';
  end if;
  next_generation := state_row.reset_generation + 1;
  delete from private.scoring_handovers where id is not null;
  delete from private.match_ownership where match_id is not null;
  if p_mode = 'progress' then
    delete from public.match_games where id is not null;
    delete from public.team_fixtures where tournament_id = tournament_row.id and stage <> 'group';
    update public.matches
    set state = 'unstarted', result_kind = null, winner_side = null,
        version = version + 1, updated_at = clock_timestamp()
    where fixture_id in (
      select id from public.team_fixtures
      where tournament_id = tournament_row.id and stage = 'group'
    );
    update public.tournament
    set stage = case when exists (select 1 from public.matches) then 'groups' else 'setup' end,
        setup_locked_at = case when exists (select 1 from public.matches) then clock_timestamp() else null end,
        version = version + 1, result_revision = result_revision + 1,
        updated_at = clock_timestamp()
    where id = tournament_row.id returning version into next_version;
  else
    delete from public.tournament where id = tournament_row.id;
    next_version := 0;
  end if;
  update private.maintenance_state
  set reset_enabled = false, reset_generation = next_generation, updated_at = clock_timestamp()
  where singleton;
  update public.tournament_generation set reset_generation = next_generation where singleton;
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

revoke all on function public.reset_tournament(uuid, integer, uuid, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.reset_tournament(uuid, integer, uuid, integer, text, text)
  to service_role;
