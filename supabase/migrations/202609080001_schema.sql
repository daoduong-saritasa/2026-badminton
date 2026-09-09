create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.tournament (
  id uuid primary key default extensions.gen_random_uuid(),
  singleton boolean not null default true check (singleton),
  name text not null check (length(btrim(name)) > 0),
  stage text not null default 'setup'
    check (stage in ('setup', 'groups', 'knockouts', 'completed')),
  setup_locked_at timestamptz,
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (singleton)
);

create table public.players (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  seed smallint not null check (seed in (1, 2)),
  created_at timestamptz not null default now()
);

create table public.pairs (
  id uuid primary key default extensions.gen_random_uuid(),
  team_name text check (team_name is null or length(btrim(team_name)) > 0),
  player_a_id uuid not null references public.players (id) on delete restrict,
  player_b_id uuid not null references public.players (id) on delete restrict,
  group_code text not null check (group_code in ('A', 'B')),
  withdrawn boolean not null default false,
  created_at timestamptz not null default now(),
  check (player_a_id <> player_b_id)
);

create or replace function private.enforce_unique_pair_players()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.players
  where id in (new.player_a_id, new.player_b_id)
  order by id
  for update;

  if exists (
    select 1
    from public.pairs as existing
    where existing.id <> new.id
      and (
        existing.player_a_id in (new.player_a_id, new.player_b_id)
        or existing.player_b_id in (new.player_a_id, new.player_b_id)
      )
  ) then
    raise exception 'A player can belong to only one pair'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_unique_pair_players() from public;

create trigger pairs_unique_players
before insert or update of player_a_id, player_b_id on public.pairs
for each row execute function private.enforce_unique_pair_players();

create table public.matches (
  id uuid primary key default extensions.gen_random_uuid(),
  tournament_id uuid not null references public.tournament (id) on delete cascade,
  round text not null check (round in ('group', 'semifinal', 'final')),
  group_code text check (group_code in ('A', 'B')),
  pair_a_id uuid references public.pairs (id) on delete restrict,
  pair_b_id uuid references public.pairs (id) on delete restrict,
  source_a_label text,
  source_b_label text,
  source_a_match_id uuid references public.matches (id) on delete restrict,
  source_b_match_id uuid references public.matches (id) on delete restrict,
  court smallint check (court in (1, 2)),
  playing_order integer not null check (playing_order > 0),
  state text not null default 'unstarted'
    check (state in ('unstarted', 'playing', 'completed', 'void')),
  score_a smallint check (score_a between 0 and 30),
  score_b smallint check (score_b between 0 and 30),
  result_kind text check (result_kind in ('played', 'walkover')),
  winner_id uuid references public.pairs (id) on delete restrict,
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (pair_a_id is null or pair_b_id is null or pair_a_id <> pair_b_id),
  check ((round = 'group' and group_code is not null) or (round <> 'group' and group_code is null)),
  check (round <> 'group' or (pair_a_id is not null and pair_b_id is not null)),
  check (state = 'unstarted' or (pair_a_id is not null and pair_b_id is not null)),
  check (
    (state = 'unstarted' and score_a is null and score_b is null and result_kind is null and winner_id is null)
    or (state = 'playing' and score_a is not null and score_b is not null and result_kind is null and winner_id is null)
    or (
      state = 'completed'
      and winner_id is not null
      and (
        (result_kind = 'played' and score_a is not null and score_b is not null)
        or (result_kind = 'walkover' and score_a is null and score_b is null)
      )
    )
    or (state = 'void' and score_a is null and score_b is null and result_kind is null and winner_id is null)
  ),
  check (winner_id is null or winner_id in (pair_a_id, pair_b_id))
);

create unique index matches_group_pairing_unique
on public.matches (
  tournament_id,
  group_code,
  least(pair_a_id, pair_b_id),
  greatest(pair_a_id, pair_b_id)
)
where round = 'group';

create unique index matches_playing_order_court_unique
on public.matches (tournament_id, playing_order, court)
where court is not null and state <> 'void';

create table public.tie_resolutions (
  tournament_id uuid not null references public.tournament (id) on delete cascade,
  group_code text not null check (group_code in ('A', 'B')),
  ordered_pair_ids uuid[] not null check (cardinality(ordered_pair_ids) >= 2),
  explanation text not null check (length(btrim(explanation)) > 0),
  standings_revision integer not null check (standings_revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tournament_id, group_code)
);

create table private.staff_grants (
  session_id uuid primary key references auth.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  pin_generation integer not null check (pin_generation > 0),
  check (expires_at > granted_at),
  check (revoked_at is null or revoked_at >= granted_at)
);

create index staff_grants_user_id_idx on private.staff_grants (user_id);

create table private.staff_config (
  singleton boolean primary key default true check (singleton),
  pin_hash text not null check (length(pin_hash) > 0),
  generation integer not null default 1 check (generation > 0),
  updated_at timestamptz not null default now()
);

create table private.pin_attempts (
  bucket text primary key check (length(bucket) between 1 and 256),
  window_started_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

create table private.match_ownership (
  match_id uuid primary key references public.matches (id) on delete cascade,
  session_id uuid not null references auth.sessions (id) on delete cascade,
  claimed_at timestamptz not null default now()
);

create index match_ownership_session_id_idx on private.match_ownership (session_id);

create table private.mutation_log (
  request_id uuid not null,
  staff_session_id uuid not null references auth.sessions (id) on delete cascade,
  operation text not null check (length(operation) > 0),
  payload_fingerprint text not null check (length(payload_fingerprint) > 0),
  response jsonb not null,
  created_at timestamptz not null default now(),
  match_id uuid references public.matches (id) on delete set null,
  point_side text check (point_side in ('a', 'b')),
  undone boolean not null default false,
  primary key (request_id, staff_session_id)
);

create index mutation_log_match_id_idx on private.mutation_log (match_id);

revoke all on all tables in schema public from anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;

alter default privileges in schema private revoke all on tables from public, anon, authenticated;
alter default privileges in schema private revoke all on sequences from public, anon, authenticated;
alter default privileges in schema private revoke all on functions from public, anon, authenticated;
