-- Split shared staff access into organizer and referee roles.

alter table private.staff_config add column role text;
update private.staff_config set role = 'organizer';
alter table private.staff_config alter column role set not null;
alter table private.staff_config
  add constraint staff_config_role_check check (role in ('organizer', 'referee'));
alter table private.staff_config drop constraint staff_config_pkey;
alter table private.staff_config drop constraint staff_config_singleton_check;
alter table private.staff_config drop column singleton;
alter table private.staff_config add primary key (role);

insert into private.staff_config (role, pin_hash, generation, updated_at)
values (
  'referee',
  extensions.crypt(extensions.gen_random_uuid()::text, extensions.gen_salt('bf', 12)),
  1,
  clock_timestamp()
);

alter table private.staff_grants
  add column role text not null default 'organizer'
  check (role in ('organizer', 'referee'));
alter table private.staff_grants alter column role drop default;

-- Grants issued before roles existed cannot safely inherit organizer access.
update private.staff_grants
set revoked_at = clock_timestamp()
where revoked_at is null;

create or replace function private.has_staff_access(
  p_session_id uuid,
  p_user_id uuid
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.staff_grants as staff_grant
    join private.staff_config as staff_config on staff_config.role = staff_grant.role
    join auth.sessions as auth_session
      on auth_session.id = staff_grant.session_id
      and auth_session.user_id = staff_grant.user_id
    where staff_grant.session_id = p_session_id
      and staff_grant.user_id = p_user_id
      and staff_grant.revoked_at is null
      and staff_grant.expires_at > clock_timestamp()
      and staff_grant.pin_generation = staff_config.generation
  );
$$;

create or replace function private.staff_role()
returns text
language sql
security definer
set search_path = ''
as $$
  select staff_grant.role
  from private.staff_grants as staff_grant
  join private.staff_config as staff_config on staff_config.role = staff_grant.role
  join auth.sessions as auth_session
    on auth_session.id = staff_grant.session_id
    and auth_session.user_id = staff_grant.user_id
  where staff_grant.session_id = private.request_session_id()
    and staff_grant.user_id = auth.uid()
    and staff_grant.revoked_at is null
    and staff_grant.expires_at > clock_timestamp()
    and staff_grant.pin_generation = staff_config.generation;
$$;

create or replace function private.require_organizer()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_session_id uuid := private.require_staff_access();
begin
  if private.staff_role() is distinct from 'organizer' then
    raise exception 'Organizer access required' using errcode = '42501';
  end if;
  return request_session_id;
end;
$$;

create or replace function private.require_scorer()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_session_id uuid := private.require_staff_access();
begin
  if private.staff_role() not in ('organizer', 'referee') then
    raise exception 'Scoring access required' using errcode = '42501';
  end if;
  return request_session_id;
end;
$$;

create or replace function private.issue_staff_grant(
  p_session_id uuid,
  p_user_id uuid,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_generation integer;
  grant_expiry timestamptz := clock_timestamp() + interval '7 days';
begin
  perform private.require_verified_identity(p_session_id, p_user_id);

  select generation
  into strict current_generation
  from private.staff_config
  where role = p_role
  for share;

  insert into private.staff_grants (
    session_id,
    user_id,
    role,
    granted_at,
    expires_at,
    revoked_at,
    pin_generation
  ) values (
    p_session_id,
    p_user_id,
    p_role,
    clock_timestamp(),
    grant_expiry,
    null,
    current_generation
  )
  on conflict (session_id) do update
  set user_id = excluded.user_id,
      role = excluded.role,
      granted_at = excluded.granted_at,
      expires_at = excluded.expires_at,
      revoked_at = null,
      pin_generation = excluded.pin_generation;

  return jsonb_build_object(
    'sessionId', p_session_id,
    'expiresAt', grant_expiry,
    'role', p_role
  );
end;
$$;

create or replace function public.exchange_staff_pin(
  p_session_id uuid,
  p_user_id uuid,
  p_bucket text,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  configured_role text;
  pin_valid boolean;
  retry_after integer;
begin
  perform private.require_verified_identity(p_session_id, p_user_id);

  if p_pin is null or length(p_pin) not between 4 and 12 or p_pin !~ '^[0-9]+$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_pin');
  end if;

  select role
  into configured_role
  from private.staff_config
  where extensions.crypt(p_pin, pin_hash) = pin_hash
  limit 1;

  pin_valid := configured_role is not null;
  retry_after := private.consume_pin_attempt(p_bucket, pin_valid);

  if retry_after > 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'rate_limited',
      'retryAfterSeconds', retry_after
    );
  end if;

  if retry_after < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_pin');
  end if;

  return jsonb_build_object(
    'ok', true,
    'access', private.issue_staff_grant(p_session_id, p_user_id, configured_role)
  );
end;
$$;

drop function public.rotate_staff_pin_for_session(uuid, uuid, text);

create function public.rotate_staff_pin_for_session(
  p_session_id uuid,
  p_user_id uuid,
  p_role text,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester_role text;
  other_pin_hash text;
  next_generation integer;
begin
  perform private.require_verified_identity(p_session_id, p_user_id);

  if not private.has_staff_access(p_session_id, p_user_id) then
    raise exception 'Staff access expired or revoked' using errcode = '42501';
  end if;

  select role into requester_role
  from private.staff_grants
  where session_id = p_session_id and user_id = p_user_id;

  if requester_role is distinct from 'organizer' then
    raise exception 'Organizer access required' using errcode = '42501';
  end if;

  if p_role not in ('organizer', 'referee') then
    raise exception 'Unknown staff role' using errcode = '22023';
  end if;

  if p_pin is null or length(p_pin) not between 4 and 12 or p_pin !~ '^[0-9]+$' then
    raise exception 'PIN must contain 4 to 12 digits' using errcode = '22023';
  end if;

  perform 1 from private.staff_config for update;
  select pin_hash into strict other_pin_hash
  from private.staff_config
  where role <> p_role;

  if extensions.crypt(p_pin, other_pin_hash) = other_pin_hash then
    raise exception 'Staff role PINs must differ' using errcode = '22023';
  end if;

  update private.staff_config
  set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 12)),
      generation = generation + 1,
      updated_at = clock_timestamp()
  where role = p_role
  returning generation into strict next_generation;

  update private.staff_grants
  set revoked_at = clock_timestamp()
  where role = p_role and revoked_at is null;

  return private.issue_staff_grant(p_session_id, p_user_id, requester_role)
    || jsonb_build_object('pinGeneration', next_generation);
end;
$$;

create or replace function public.get_staff_access()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_user_id uuid := auth.uid();
  request_session_id uuid := private.request_session_id();
  access_expiry timestamptz;
  access_role text;
begin
  if request_user_id is null or request_session_id is null then
    return null;
  end if;

  select staff_grant.expires_at, staff_grant.role
  into access_expiry, access_role
  from private.staff_grants as staff_grant
  join private.staff_config as staff_config on staff_config.role = staff_grant.role
  where staff_grant.session_id = request_session_id
    and staff_grant.user_id = request_user_id
    and staff_grant.revoked_at is null
    and staff_grant.expires_at > clock_timestamp()
    and staff_grant.pin_generation = staff_config.generation;

  if access_expiry is null then
    return null;
  end if;

  return jsonb_build_object(
    'sessionId', request_session_id,
    'expiresAt', access_expiry,
    'role', access_role
  );
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
  if p_operation in ('start_scoring', 'take_over', 'add_point', 'undo_point', 'confirm_result') then
    perform private.require_scorer();
  else
    perform private.require_organizer();
  end if;

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
  current_revision integer;
  allow_completed boolean;
  new_score_a integer := (p_score ->> 'a')::integer;
  new_score_b integer := (p_score ->> 'b')::integer;
  new_winner uuid;
  block_code text;
  before_body jsonb;
begin
  perform private.require_organizer();
  perform private.require_reset_generation(p_reset_generation);

  select result_revision into current_revision from public.tournament where singleton;
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
    current_revision,
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
  current_revision integer;
  block_code text;
  before_body jsonb;
begin
  perform private.require_organizer();
  perform private.require_reset_generation(p_reset_generation);

  select result_revision into current_revision from public.tournament where singleton;
  if not found then
    raise exception 'Tournament is not configured' using errcode = 'P0002';
  end if;

  block_code := private.withdrawal_block_code(p_pair_id);
  before_body := private.snapshot_body();

  return private.impact(
    current_revision,
    block_code,
    before_body,
    case when block_code is null then private.project_mutation(
      'withdraw_pair',
      jsonb_build_object('pairId', p_pair_id)
    ) end
  );
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated, service_role;
revoke all on function public.rotate_staff_pin_for_session(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.rotate_staff_pin_for_session(uuid, uuid, text, text)
to service_role;
