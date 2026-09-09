alter table public.tournament enable row level security;
alter table public.players enable row level security;
alter table public.pairs enable row level security;
alter table public.matches enable row level security;
alter table public.tie_resolutions enable row level security;

create policy tournament_public_read on public.tournament
for select to anon, authenticated using (true);
create policy players_public_read on public.players
for select to anon, authenticated using (true);
create policy pairs_public_read on public.pairs
for select to anon, authenticated using (true);
create policy matches_public_read on public.matches
for select to anon, authenticated using (true);
create policy tie_resolutions_public_read on public.tie_resolutions
for select to anon, authenticated using (true);

grant usage on schema public to anon, authenticated;
grant select on public.tournament, public.players, public.pairs, public.matches, public.tie_resolutions
to anon, authenticated;

create or replace function private.request_session_id()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  session_claim text := auth.jwt() ->> 'session_id';
begin
  if session_claim is null or session_claim = '' then
    return null;
  end if;

  begin
    return session_claim::uuid;
  exception
    when invalid_text_representation then
      return null;
  end;
end;
$$;

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
    join private.staff_config as staff_config on staff_config.singleton
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

create or replace function private.require_staff_access()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_user_id uuid := auth.uid();
  request_session_id uuid := private.request_session_id();
begin
  if request_user_id is null or request_session_id is null then
    raise exception 'Staff authentication required' using errcode = '42501';
  end if;

  if not private.has_staff_access(request_session_id, request_user_id) then
    raise exception 'Staff access expired or revoked' using errcode = '42501';
  end if;

  return request_session_id;
end;
$$;

create or replace function private.require_verified_identity(
  p_session_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_session_id is null or p_user_id is null or not exists (
    select 1
    from auth.sessions
    where id = p_session_id and user_id = p_user_id
  ) then
    raise exception 'Verified session identity required' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.issue_staff_grant(
  p_session_id uuid,
  p_user_id uuid
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
  where singleton
  for share;

  insert into private.staff_grants (
    session_id,
    user_id,
    granted_at,
    expires_at,
    revoked_at,
    pin_generation
  ) values (
    p_session_id,
    p_user_id,
    clock_timestamp(),
    grant_expiry,
    null,
    current_generation
  )
  on conflict (session_id) do update
  set user_id = excluded.user_id,
      granted_at = excluded.granted_at,
      expires_at = excluded.expires_at,
      revoked_at = null,
      pin_generation = excluded.pin_generation;

  return jsonb_build_object(
    'sessionId', p_session_id,
    'expiresAt', grant_expiry
  );
end;
$$;

create or replace function private.consume_pin_attempt(
  p_bucket text,
  p_pin_valid boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt private.pin_attempts%rowtype;
  current_time timestamptz := clock_timestamp();
begin
  if p_bucket is null or length(p_bucket) not between 1 and 256 then
    raise exception 'Invalid rate-limit bucket' using errcode = '22023';
  end if;

  insert into private.pin_attempts (bucket, window_started_at, attempt_count, updated_at)
  values (p_bucket, current_time, 0, current_time)
  on conflict (bucket) do nothing;

  select * into strict attempt
  from private.pin_attempts
  where bucket = p_bucket
  for update;

  if attempt.blocked_until is not null and attempt.blocked_until > current_time then
    return greatest(1, ceil(extract(epoch from attempt.blocked_until - current_time)))::integer;
  end if;

  if p_pin_valid then
    delete from private.pin_attempts where bucket = p_bucket;
    return 0;
  end if;

  if attempt.window_started_at <= current_time - interval '15 minutes' then
    attempt.window_started_at := current_time;
    attempt.attempt_count := 0;
  end if;

  attempt.attempt_count := attempt.attempt_count + 1;

  update private.pin_attempts
  set window_started_at = attempt.window_started_at,
      attempt_count = attempt.attempt_count,
      blocked_until = case
        when attempt.attempt_count >= 5 then current_time + interval '15 minutes'
        else null
      end,
      updated_at = current_time
  where bucket = p_bucket;

  if attempt.attempt_count >= 5 then
    return 900;
  end if;

  return -1;
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
  configured_hash text;
  pin_valid boolean;
  retry_after integer;
begin
  perform private.require_verified_identity(p_session_id, p_user_id);

  if p_pin is null or length(p_pin) not between 4 and 12 or p_pin !~ '^[0-9]+$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_pin');
  end if;

  select pin_hash into strict configured_hash
  from private.staff_config
  where singleton
  for share;

  pin_valid := extensions.crypt(p_pin, configured_hash) = configured_hash;
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
    'access', private.issue_staff_grant(p_session_id, p_user_id)
  );
end;
$$;

create or replace function public.rotate_staff_pin_for_session(
  p_session_id uuid,
  p_user_id uuid,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_generation integer;
begin
  perform private.require_verified_identity(p_session_id, p_user_id);

  if not private.has_staff_access(p_session_id, p_user_id) then
    raise exception 'Staff access expired or revoked' using errcode = '42501';
  end if;

  if p_pin is null or length(p_pin) not between 4 and 12 or p_pin !~ '^[0-9]+$' then
    raise exception 'PIN must contain 4 to 12 digits' using errcode = '22023';
  end if;

  update private.staff_config
  set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 12)),
      generation = generation + 1,
      updated_at = clock_timestamp()
  where singleton
  returning generation into strict next_generation;

  update private.staff_grants
  set revoked_at = clock_timestamp()
  where revoked_at is null;

  return private.issue_staff_grant(p_session_id, p_user_id)
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
begin
  if request_user_id is null or request_session_id is null then
    return null;
  end if;

  select staff_grant.expires_at
  into access_expiry
  from private.staff_grants as staff_grant
  join private.staff_config as staff_config on staff_config.singleton
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
    'expiresAt', access_expiry
  );
end;
$$;

create or replace function public.get_score_access(p_match_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_user_id uuid := auth.uid();
  request_session_id uuid := private.request_session_id();
begin
  if request_user_id is null or request_session_id is null then
    return false;
  end if;

  return private.has_staff_access(request_session_id, request_user_id)
    and exists (
      select 1
      from private.match_ownership
      where match_id = p_match_id and session_id = request_session_id
    );
end;
$$;

create or replace function public.revoke_staff_access()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_user_id uuid := auth.uid();
  request_session_id uuid := private.request_session_id();
begin
  if request_user_id is null or request_session_id is null then
    raise exception 'Authenticated session required' using errcode = '42501';
  end if;

  update private.staff_grants
  set revoked_at = clock_timestamp()
  where session_id = request_session_id
    and user_id = request_user_id
    and revoked_at is null;

  delete from private.match_ownership where session_id = request_session_id;
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated, service_role;
revoke all on function public.exchange_staff_pin(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.rotate_staff_pin_for_session(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.get_staff_access() from public, anon;
revoke all on function public.get_score_access(uuid) from public, anon;
revoke all on function public.revoke_staff_access() from public, anon;

grant execute on function public.exchange_staff_pin(uuid, uuid, text, text) to service_role;
grant execute on function public.rotate_staff_pin_for_session(uuid, uuid, text) to service_role;
grant execute on function public.get_staff_access() to authenticated;
grant execute on function public.get_score_access(uuid) to authenticated;
grant execute on function public.revoke_staff_access() to authenticated;
