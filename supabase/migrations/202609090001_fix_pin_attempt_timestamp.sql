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
  observed_at timestamptz := clock_timestamp();
begin
  if p_bucket is null or length(p_bucket) not between 1 and 256 then
    raise exception 'Invalid rate-limit bucket' using errcode = '22023';
  end if;

  insert into private.pin_attempts (bucket, window_started_at, attempt_count, updated_at)
  values (p_bucket, observed_at, 0, observed_at)
  on conflict (bucket) do nothing;

  select * into strict attempt
  from private.pin_attempts
  where bucket = p_bucket
  for update;

  if attempt.blocked_until is not null and attempt.blocked_until > observed_at then
    return greatest(1, ceil(extract(epoch from attempt.blocked_until - observed_at)))::integer;
  end if;

  if p_pin_valid then
    delete from private.pin_attempts where bucket = p_bucket;
    return 0;
  end if;

  if attempt.window_started_at <= observed_at - interval '15 minutes' then
    attempt.window_started_at := observed_at;
    attempt.attempt_count := 0;
  end if;

  attempt.attempt_count := attempt.attempt_count + 1;

  update private.pin_attempts
  set window_started_at = attempt.window_started_at,
      attempt_count = attempt.attempt_count,
      blocked_until = case
        when attempt.attempt_count >= 5 then observed_at + interval '15 minutes'
        else null
      end,
      updated_at = observed_at
  where bucket = p_bucket;

  if attempt.attempt_count >= 5 then
    return 900;
  end if;

  return -1;
end;
$$;

revoke all on function private.consume_pin_attempt(text, boolean)
from public, anon, authenticated, service_role;
