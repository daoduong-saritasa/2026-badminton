-- Replace the legacy pair tournament with the four-player team tournament.
-- This migration is intentionally forward-only. Run Reset all before applying it.

do $$
begin
  if exists (select 1 from public.pairs)
    or exists (select 1 from public.matches)
    or exists (select 1 from public.players) then
    raise exception 'Reset all must run before the team tournament migration'
      using errcode = '55000';
  end if;
end;
$$;

-- Remove the legacy public command surface before its backing model disappears.
do $$
declare
  legacy_function record;
begin
  for legacy_function in
    select namespace.nspname as schema_name,
           procedure.proname as function_name,
           pg_catalog.pg_get_function_identity_arguments(procedure.oid) as arguments
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where (
      namespace.nspname = 'public'
      and procedure.proname in (
        'save_setup', 'set_court_count', 'generate_fixtures', 'assign_courts',
        'start_scoring', 'take_over', 'add_point', 'undo_point', 'confirm_result',
        'enter_result', 'correct_result', 'mark_walkover', 'withdraw_pair',
        'resolve_tie', 'confirm_groups', 'reopen_tournament',
        'preview_result_correction', 'preview_withdrawal'
      )
    ) or (
      namespace.nspname = 'private'
      and (
        procedure.proname like 'legacy\_%' escape '\'
        or procedure.proname in (
          'invoke_legacy_mutation', 'enforce_unique_pair_players',
          'compute_standings', 'apply_progression', 'is_winning_score',
          'finish_direct_result', 'correction_block_code',
          'withdrawal_block_code', 'assert_correction_safe',
          'project_mutation', 'impact'
        )
      )
    )
  loop
    execute format(
      'drop function %I.%I(%s) cascade',
      legacy_function.schema_name,
      legacy_function.function_name,
      legacy_function.arguments
    );
  end loop;
end;
$$;

drop function public.get_tournament_snapshot();
drop function public.get_score_access(uuid);
drop function private.snapshot_body();

drop table private.match_ownership;
alter table private.mutation_log drop constraint mutation_log_match_id_fkey;

drop table public.tie_resolutions;
drop table public.matches;
drop table public.pairs;

alter table public.tournament drop column court_count;

create table public.teams (
  id uuid primary key default extensions.gen_random_uuid(),
  tournament_id uuid not null references public.tournament (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  group_code text not null check (group_code in ('A', 'B')),
  created_at timestamptz not null default now(),
  unique (tournament_id, name),
  unique (tournament_id, id)
);

alter table public.players
  add column team_id uuid not null references public.teams (id) on delete cascade;
create index players_team_id_idx on public.players (team_id);

create table public.team_fixtures (
  id uuid primary key default extensions.gen_random_uuid(),
  tournament_id uuid not null references public.tournament (id) on delete cascade,
  stage text not null check (stage in ('group', 'third-place', 'final')),
  group_code text check (group_code in ('A', 'B')),
  team_a_id uuid references public.teams (id) on delete restrict,
  team_b_id uuid references public.teams (id) on delete restrict,
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((stage = 'group') = (group_code is not null)),
  check (team_a_id is null or team_b_id is null or team_a_id <> team_b_id),
  unique (tournament_id, stage, group_code)
);

-- A partial index permits one final and one third-place fixture while the
-- table constraint above keeps one fixture for each group code.
create unique index team_fixtures_group_unique
  on public.team_fixtures (tournament_id, group_code)
  where stage = 'group';
create unique index team_fixtures_placement_unique
  on public.team_fixtures (tournament_id, stage)
  where stage <> 'group';

create table public.matches (
  id uuid primary key default extensions.gen_random_uuid(),
  fixture_id uuid not null references public.team_fixtures (id) on delete cascade,
  match_number smallint not null check (match_number in (1, 2, 3)),
  pair_a_seed1_player_id uuid references public.players (id) on delete restrict,
  pair_a_seed2_player_id uuid references public.players (id) on delete restrict,
  pair_b_seed1_player_id uuid references public.players (id) on delete restrict,
  pair_b_seed2_player_id uuid references public.players (id) on delete restrict,
  court smallint check (court in (1, 2)),
  state text not null default 'unstarted'
    check (state in ('unstarted', 'playing', 'completed', 'unnecessary')),
  result_kind text check (result_kind in ('played', 'walkover')),
  winner_side text check (winner_side in ('a', 'b')),
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fixture_id, match_number),
  check (
    (pair_a_seed1_player_id is null and pair_a_seed2_player_id is null
      and pair_b_seed1_player_id is null and pair_b_seed2_player_id is null)
    or
    (pair_a_seed1_player_id is not null and pair_a_seed2_player_id is not null
      and pair_b_seed1_player_id is not null and pair_b_seed2_player_id is not null)
  ),
  check (
    (state in ('unstarted', 'playing') and result_kind is null and winner_side is null)
    or (state = 'completed' and result_kind is not null and winner_side is not null)
    or (state = 'unnecessary' and result_kind is null and winner_side is null)
  )
);

create unique index matches_active_court_unique
  on public.matches (court)
  where state = 'playing';

create table public.match_games (
  id uuid primary key default extensions.gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  game_number smallint not null check (game_number between 1 and 3),
  score_a smallint not null default 0 check (score_a between 0 and 30),
  score_b smallint not null default 0 check (score_b between 0 and 30),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, game_number)
);

alter table private.mutation_log
  add constraint mutation_log_match_id_fkey
  foreign key (match_id) references public.matches (id) on delete set null;

create table private.lineups (
  fixture_id uuid not null references public.team_fixtures (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  match_number smallint not null check (match_number in (1, 2, 3)),
  seed1_player_id uuid not null references public.players (id) on delete restrict,
  seed2_player_id uuid not null references public.players (id) on delete restrict,
  confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (fixture_id, team_id, match_number),
  check (seed1_player_id <> seed2_player_id)
);

create table private.match_ownership (
  match_id uuid primary key references public.matches (id) on delete cascade,
  session_id uuid not null references auth.sessions (id) on delete cascade,
  claimed_at timestamptz not null default now()
);
create index match_ownership_session_id_idx on private.match_ownership (session_id);

create table private.scoring_handovers (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches (id) on delete cascade,
  from_session_id uuid not null references auth.sessions (id) on delete cascade,
  to_session_id uuid not null references auth.sessions (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (from_session_id <> to_session_id)
);
create index scoring_handovers_match_id_idx
  on private.scoring_handovers (match_id, created_at);

alter table public.teams enable row level security;
alter table public.team_fixtures enable row level security;
alter table public.matches enable row level security;
alter table public.match_games enable row level security;

create policy teams_public_read on public.teams
for select to anon, authenticated using (true);
create policy team_fixtures_public_read on public.team_fixtures
for select to anon, authenticated using (true);
create policy matches_public_read on public.matches
for select to anon, authenticated using (true);
create policy match_games_public_read on public.match_games
for select to anon, authenticated using (true);

grant select on public.teams, public.players, public.team_fixtures,
  public.matches, public.match_games to anon, authenticated;
revoke all on private.lineups, private.match_ownership,
  private.scoring_handovers from public, anon, authenticated, service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['teams', 'team_fixtures', 'matches', 'match_games']
  loop
    if not exists (
      select 1
      from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;

create or replace function private.snapshot_body()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'tournament', to_jsonb(tournament_row) - 'singleton' - 'created_at' - 'updated_at',
    'teams', coalesce((
      select jsonb_agg(to_jsonb(team_row) - 'tournament_id' - 'created_at' order by team_row.group_code, team_row.name, team_row.id)
      from public.teams as team_row
      where team_row.tournament_id = tournament_row.id
    ), '[]'::jsonb),
    'players', coalesce((
      select jsonb_agg(to_jsonb(player_row) - 'created_at' order by player_row.team_id, player_row.seed, player_row.name, player_row.id)
      from public.players as player_row
      join public.teams as team_row on team_row.id = player_row.team_id
      where team_row.tournament_id = tournament_row.id
    ), '[]'::jsonb),
    'fixtures', coalesce((
      select jsonb_agg(to_jsonb(fixture_row) - 'tournament_id' - 'created_at' - 'updated_at' order by
        case fixture_row.stage when 'group' then 1 when 'third-place' then 2 else 3 end,
        fixture_row.group_code nulls last,
        fixture_row.id)
      from public.team_fixtures as fixture_row
      where fixture_row.tournament_id = tournament_row.id
    ), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(to_jsonb(match_row) - 'created_at' - 'updated_at' order by fixture_row.stage, fixture_row.group_code nulls last, match_row.match_number)
      from public.matches as match_row
      join public.team_fixtures as fixture_row on fixture_row.id = match_row.fixture_id
      where fixture_row.tournament_id = tournament_row.id
    ), '[]'::jsonb),
    'games', coalesce((
      select jsonb_agg(to_jsonb(game_row) - 'created_at' - 'updated_at' order by game_row.match_id, game_row.game_number)
      from public.match_games as game_row
      join public.matches as match_row on match_row.id = game_row.match_id
      join public.team_fixtures as fixture_row on fixture_row.id = match_row.fixture_id
      where fixture_row.tournament_id = tournament_row.id
    ), '[]'::jsonb),
    'lineups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'fixtureId', lineup.fixture_id,
        'teamId', lineup.team_id,
        'pairs', lineup.pairs,
        'confirmedAt', lineup.confirmed_at
      ) order by lineup.fixture_id, lineup.team_id)
      from (
        select lineup_row.fixture_id,
               lineup_row.team_id,
               jsonb_agg(jsonb_build_object(
                 'seed1PlayerId', lineup_row.seed1_player_id,
                 'seed2PlayerId', lineup_row.seed2_player_id
               ) order by lineup_row.match_number) as pairs,
               min(lineup_row.confirmed_at) as confirmed_at
        from private.lineups as lineup_row
        where private.staff_role() = 'organizer'
          or (
            select count(distinct confirmed.team_id)
            from private.lineups as confirmed
            where confirmed.fixture_id = lineup_row.fixture_id
              and confirmed.confirmed_at is not null
          ) = 2
        group by lineup_row.fixture_id, lineup_row.team_id
      ) as lineup
    ), '[]'::jsonb)
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

revoke all on function private.snapshot_body()
  from public, anon, authenticated, service_role;
revoke all on function public.get_tournament_snapshot()
  from public, anon, authenticated, service_role;
grant execute on function public.get_tournament_snapshot() to anon, authenticated;

-- Shared team-tournament rules ---------------------------------------------

create or replace function private.is_game_won(
  p_score_a integer,
  p_score_b integer,
  p_stage text
)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  target integer := case when p_stage = 'final' then 21 else 15 end;
  cap integer := case when p_stage = 'final' then 30 else 21 end;
  winner integer := greatest(p_score_a, p_score_b);
  loser integer := least(p_score_a, p_score_b);
begin
  if p_score_a < 0 or p_score_b < 0 or p_score_a > cap or p_score_b > cap
    or p_score_a = p_score_b then
    return false;
  end if;
  if winner = cap then
    return loser = cap - 1 or winner - loser = 2;
  end if;
  if winner = target then
    return loser <= target - 2;
  end if;
  return winner > target and winner < cap and winner - loser = 2;
end;
$$;

create or replace function private.fixture_tally(p_fixture_id uuid)
returns table (wins_a integer, wins_b integer)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) filter (where winner_side = 'a')::integer,
         count(*) filter (where winner_side = 'b')::integer
  from public.matches
  where fixture_id = p_fixture_id
    and state = 'completed';
$$;

create or replace function private.fixture_winner_team_id(p_fixture_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when tally.wins_a >= 2 then fixture.team_a_id
    when tally.wins_b >= 2 then fixture.team_b_id
    else null
  end
  from public.team_fixtures as fixture
  cross join lateral private.fixture_tally(fixture.id) as tally
  where fixture.id = p_fixture_id;
$$;

create or replace function private.sync_fixture_matches(p_fixture_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  fixture public.team_fixtures%rowtype;
  lineup_count integer;
begin
  select * into strict fixture
  from public.team_fixtures
  where id = p_fixture_id
  for update;

  if fixture.team_a_id is null or fixture.team_b_id is null then
    raise exception 'Fixture participants are not assigned' using errcode = '55000';
  end if;

  select count(*) into lineup_count
  from private.lineups
  where fixture_id = fixture.id
    and team_id in (fixture.team_a_id, fixture.team_b_id)
    and confirmed_at is not null;

  if lineup_count <> 6 then
    raise exception 'Both lineups must be confirmed' using errcode = '55000';
  end if;

  insert into public.matches (fixture_id, match_number)
  select fixture.id, match_number
  from generate_series(1, 3) as match_number
  on conflict (fixture_id, match_number) do nothing;

  update public.matches as match
  set pair_a_seed1_player_id = lineup_a.seed1_player_id,
      pair_a_seed2_player_id = lineup_a.seed2_player_id,
      pair_b_seed1_player_id = lineup_b.seed1_player_id,
      pair_b_seed2_player_id = lineup_b.seed2_player_id,
      version = match.version + 1,
      updated_at = clock_timestamp()
  from private.lineups as lineup_a,
       private.lineups as lineup_b
  where match.fixture_id = fixture.id
    and lineup_a.fixture_id = fixture.id
    and lineup_a.team_id = fixture.team_a_id
    and lineup_a.match_number = match.match_number
    and lineup_b.fixture_id = fixture.id
    and lineup_b.team_id = fixture.team_b_id
    and lineup_b.match_number = match.match_number
    and match.state = 'unstarted';
end;
$$;

create or replace function private.populate_placement_fixtures()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tournament_id uuid;
  group_a public.team_fixtures%rowtype;
  group_b public.team_fixtures%rowtype;
  winner_a uuid;
  winner_b uuid;
  loser_a uuid;
  loser_b uuid;
  placement_started boolean;
begin
  select id into target_tournament_id from public.tournament where singleton;
  if target_tournament_id is null then return; end if;

  select * into group_a from public.team_fixtures
  where tournament_id = target_tournament_id
    and stage = 'group' and group_code = 'A';
  select * into group_b from public.team_fixtures
  where tournament_id = target_tournament_id
    and stage = 'group' and group_code = 'B';
  if group_a.id is null or group_b.id is null then return; end if;

  winner_a := private.fixture_winner_team_id(group_a.id);
  winner_b := private.fixture_winner_team_id(group_b.id);
  select exists (
    select 1 from public.matches as match
    join public.team_fixtures as fixture on fixture.id = match.fixture_id
    where fixture.tournament_id = target_tournament_id
      and fixture.stage <> 'group'
      and match.state <> 'unstarted'
  ) into placement_started;

  if placement_started then return; end if;

  if winner_a is null or winner_b is null then
    delete from public.team_fixtures
    where tournament_id = target_tournament_id and stage <> 'group';
    update public.tournament
    set stage = 'groups', updated_at = clock_timestamp()
    where id = target_tournament_id and stage = 'knockouts';
    return;
  end if;
  loser_a := case when winner_a = group_a.team_a_id then group_a.team_b_id else group_a.team_a_id end;
  loser_b := case when winner_b = group_b.team_a_id then group_b.team_b_id else group_b.team_a_id end;

  delete from private.lineups as lineup
  using public.team_fixtures as placement
  where lineup.fixture_id = placement.id
    and placement.tournament_id = target_tournament_id
    and placement.stage in ('third-place', 'final')
    and (
      placement.team_a_id is distinct from case when placement.stage = 'final' then winner_a else loser_a end
      or placement.team_b_id is distinct from case when placement.stage = 'final' then winner_b else loser_b end
    );
  delete from public.matches as match
  using public.team_fixtures as placement
  where match.fixture_id = placement.id
    and placement.tournament_id = target_tournament_id
    and placement.stage in ('third-place', 'final')
    and match.state = 'unstarted'
    and (
      placement.team_a_id is distinct from case when placement.stage = 'final' then winner_a else loser_a end
      or placement.team_b_id is distinct from case when placement.stage = 'final' then winner_b else loser_b end
    );

  insert into public.team_fixtures (tournament_id, stage, team_a_id, team_b_id)
  values
    (target_tournament_id, 'third-place', loser_a, loser_b),
    (target_tournament_id, 'final', winner_a, winner_b)
  on conflict do nothing;

  update public.team_fixtures
  set team_a_id = case when stage = 'final' then winner_a else loser_a end,
      team_b_id = case when stage = 'final' then winner_b else loser_b end,
      version = version + 1,
      updated_at = clock_timestamp()
  where team_fixtures.tournament_id = target_tournament_id
    and stage in ('third-place', 'final')
    and (
      team_a_id is distinct from case when stage = 'final' then winner_a else loser_a end
      or team_b_id is distinct from case when stage = 'final' then winner_b else loser_b end
    );

  update public.tournament
  set stage = 'knockouts', updated_at = clock_timestamp()
  where id = target_tournament_id and stage = 'groups';
end;
$$;

create or replace function private.finish_fixture_if_decided(p_fixture_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  fixture public.team_fixtures%rowtype;
  tally record;
begin
  select * into strict fixture from public.team_fixtures where id = p_fixture_id;
  select * into tally from private.fixture_tally(p_fixture_id);

  if greatest(tally.wins_a, tally.wins_b) < 2 then return; end if;

  update public.matches
  set state = 'unnecessary', court = null, version = version + 1,
      updated_at = clock_timestamp()
  where fixture_id = p_fixture_id and match_number = 3 and state = 'unstarted';

  if fixture.stage = 'group' then
    perform private.populate_placement_fixtures();
  elsif (
    select count(*)
    from public.team_fixtures as placement
    where placement.tournament_id = fixture.tournament_id
      and placement.stage in ('third-place', 'final')
      and private.fixture_winner_team_id(placement.id) is not null
  ) = 2 then
    update public.tournament
    set stage = 'completed', version = version + 1,
        result_revision = result_revision + 1,
        updated_at = clock_timestamp()
    where id = fixture.tournament_id and stage <> 'completed';
  end if;
end;
$$;

create or replace function private.bump_team_tournament(p_score_only boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare next_version integer;
begin
  update public.tournament
  set version = version + 1,
      result_revision = result_revision + case when p_score_only then 0 else 1 end,
      updated_at = clock_timestamp()
  where singleton
  returning version into strict next_version;
  return next_version;
end;
$$;

-- Command implementations --------------------------------------------------

create or replace function private.team_save_roster(
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
  team_data jsonb;
  player_data jsonb;
  team_id uuid;
  team_count integer;
  player_count integer;
  group_a_count integer;
  group_b_count integer;
  next_version integer;
begin
  if jsonb_typeof(p_payload -> 'teams') <> 'array'
    or length(btrim(p_payload ->> 'tournamentName')) = 0 then
    raise exception 'Invalid roster payload' using errcode = '22023';
  end if;

  team_count := jsonb_array_length(p_payload -> 'teams');
  select count(*) filter (where value ->> 'group' = 'A'),
         count(*) filter (where value ->> 'group' = 'B'),
         coalesce(sum(jsonb_array_length(value -> 'players')), 0)
  into group_a_count, group_b_count, player_count
  from jsonb_array_elements(p_payload -> 'teams');
  if team_count <> 4 or group_a_count <> 2 or group_b_count <> 2 or player_count <> 16 then
    raise exception 'Roster requires four teams, two per group, and sixteen players'
      using errcode = '22023';
  end if;

  select * into tournament_row from public.tournament where singleton for update;
  if not found then
    if p_expected_version is distinct from 0 then
      raise exception 'Tournament version conflict' using errcode = '40001';
    end if;
    insert into public.tournament (name) values (btrim(p_payload ->> 'tournamentName'))
    returning * into tournament_row;
  elsif tournament_row.version <> p_expected_version then
    raise exception 'Tournament version conflict' using errcode = '40001';
  elsif tournament_row.stage <> 'setup'
    or exists (select 1 from public.matches where state <> 'unstarted') then
    raise exception 'Roster is locked after group play starts' using errcode = '55000';
  end if;

  delete from public.team_fixtures where tournament_id = tournament_row.id;
  delete from public.players where team_id in (
    select id from public.teams where tournament_id = tournament_row.id
  );
  delete from public.teams where tournament_id = tournament_row.id;

  for team_data in select value from jsonb_array_elements(p_payload -> 'teams')
  loop
    if length(btrim(team_data ->> 'name')) = 0
      or team_data ->> 'group' not in ('A', 'B')
      or jsonb_typeof(team_data -> 'players') <> 'array'
      or jsonb_array_length(team_data -> 'players') <> 4
      or (select count(*) from jsonb_array_elements(team_data -> 'players') where (value ->> 'seed')::integer = 1) <> 2
      or (select count(*) from jsonb_array_elements(team_data -> 'players') where (value ->> 'seed')::integer = 2) <> 2 then
      raise exception 'Each team requires two seed 1 and two seed 2 players'
        using errcode = '22023';
    end if;
    insert into public.teams (tournament_id, name, group_code)
    values (tournament_row.id, btrim(team_data ->> 'name'), team_data ->> 'group')
    returning id into team_id;
    for player_data in select value from jsonb_array_elements(team_data -> 'players')
    loop
      if length(btrim(player_data ->> 'name')) = 0
        or (player_data ->> 'seed')::integer not in (1, 2) then
        raise exception 'Invalid player' using errcode = '22023';
      end if;
      insert into public.players (team_id, name, seed)
      values (team_id, btrim(player_data ->> 'name'), (player_data ->> 'seed')::smallint);
    end loop;
  end loop;

  insert into public.team_fixtures (tournament_id, stage, group_code, team_a_id, team_b_id)
  select tournament_row.id, 'group', group_code,
         (array_agg(id order by ordinal))[1],
         (array_agg(id order by ordinal))[2]
  from (
    select id, group_code,
           row_number() over (partition by group_code order by name, id) as ordinal
    from public.teams where tournament_id = tournament_row.id
  ) as ordered_teams
  group by group_code;

  update public.tournament
  set name = btrim(p_payload ->> 'tournamentName'),
      stage = 'setup', setup_locked_at = null,
      version = version + 1, result_revision = result_revision + 1,
      updated_at = clock_timestamp()
  where id = tournament_row.id returning version into next_version;
  return private.receipt(p_request_id, next_version);
end;
$$;

create or replace function private.team_save_lineup(
  p_request_id uuid,
  p_expected_version integer,
  p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  fixture public.team_fixtures%rowtype;
  target_team uuid := (p_payload ->> 'teamId')::uuid;
  pair_data jsonb;
  match_number integer := 0;
  seed1_id uuid;
  seed2_id uuid;
  opening_ids uuid[] := array[]::uuid[];
  opening_pair_one uuid[];
  opening_pair_two uuid[];
  next_version integer;
begin
  select * into strict fixture from public.team_fixtures
  where id = (p_payload ->> 'fixtureId')::uuid for update;
  if fixture.version <> p_expected_version then
    raise exception 'Fixture version conflict' using errcode = '40001';
  end if;
  if target_team not in (fixture.team_a_id, fixture.team_b_id)
    or jsonb_typeof(p_payload -> 'pairs') <> 'array'
    or jsonb_array_length(p_payload -> 'pairs') <> 3
    or exists (select 1 from public.matches where fixture_id = fixture.id and state <> 'unstarted')
    or (select count(*) from private.lineups where fixture_id = fixture.id and confirmed_at is not null) = 6 then
    raise exception 'Lineup cannot be changed' using errcode = '55000';
  end if;

  delete from private.lineups where fixture_id = fixture.id and team_id = target_team;
  for pair_data in select value from jsonb_array_elements(p_payload -> 'pairs')
  loop
    match_number := match_number + 1;
    seed1_id := (pair_data ->> 'seed1PlayerId')::uuid;
    seed2_id := (pair_data ->> 'seed2PlayerId')::uuid;
    if not exists (select 1 from public.players where id = seed1_id and team_id = target_team and seed = 1)
      or not exists (select 1 from public.players where id = seed2_id and team_id = target_team and seed = 2) then
      raise exception 'Lineup players must belong to the team and match their seeds'
        using errcode = '22023';
    end if;
    if match_number <= 2 then opening_ids := opening_ids || seed1_id || seed2_id; end if;
    if match_number = 1 then opening_pair_one := array[seed1_id, seed2_id]; end if;
    if match_number = 2 then opening_pair_two := array[seed1_id, seed2_id]; end if;
    if match_number = 3
      and (array[seed1_id, seed2_id] = opening_pair_one or array[seed1_id, seed2_id] = opening_pair_two) then
      raise exception 'Decider pair must differ from both opening pairs' using errcode = '22023';
    end if;
    insert into private.lineups (
      fixture_id, team_id, match_number, seed1_player_id, seed2_player_id
    ) values (fixture.id, target_team, match_number, seed1_id, seed2_id);
  end loop;
  if (select count(distinct player_id) from unnest(opening_ids) as player_id) <> 4 then
    raise exception 'Opening pairs must use all four players exactly once' using errcode = '22023';
  end if;
  update public.team_fixtures set version = version + 1, updated_at = clock_timestamp()
  where id = fixture.id returning version into next_version;
  perform private.bump_team_tournament();
  return private.receipt(p_request_id, (select version from public.tournament where singleton));
end;
$$;

create or replace function private.team_confirm_lineup(
  p_request_id uuid,
  p_expected_version integer,
  p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  fixture public.team_fixtures%rowtype;
  target_team uuid := (p_payload ->> 'teamId')::uuid;
  next_version integer;
begin
  select * into strict fixture from public.team_fixtures
  where id = (p_payload ->> 'fixtureId')::uuid for update;
  if fixture.version <> p_expected_version then raise exception 'Fixture version conflict' using errcode = '40001'; end if;
  if target_team not in (fixture.team_a_id, fixture.team_b_id)
    or (select count(*) from private.lineups where fixture_id = fixture.id and team_id = target_team) <> 3 then
    raise exception 'A complete lineup is required' using errcode = '55000';
  end if;
  update private.lineups set confirmed_at = clock_timestamp(), updated_at = clock_timestamp()
  where fixture_id = fixture.id and team_id = target_team and confirmed_at is null;
  update public.team_fixtures set version = version + 1, updated_at = clock_timestamp()
  where id = fixture.id returning version into next_version;
  if (select count(*) from private.lineups where fixture_id = fixture.id and confirmed_at is not null) = 6
    and (select stage from public.tournament where singleton) <> 'setup' then
    perform private.sync_fixture_matches(fixture.id);
  end if;
  perform private.bump_team_tournament();
  return private.receipt(p_request_id, (select version from public.tournament where singleton));
end;
$$;

create or replace function private.team_reopen_lineups(
  p_request_id uuid,
  p_expected_version integer,
  p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare fixture public.team_fixtures%rowtype; next_version integer;
begin
  select * into strict fixture from public.team_fixtures
  where id = (p_payload ->> 'fixtureId')::uuid for update;
  if fixture.version <> p_expected_version then raise exception 'Fixture version conflict' using errcode = '40001'; end if;
  if exists (select 1 from public.matches where fixture_id = fixture.id and state <> 'unstarted') then
    raise exception 'Lineups are locked after a fixture starts' using errcode = '55000';
  end if;
  update private.lineups set confirmed_at = null, updated_at = clock_timestamp()
  where fixture_id = fixture.id;
  delete from public.matches where fixture_id = fixture.id;
  update public.team_fixtures set version = version + 1, updated_at = clock_timestamp()
  where id = fixture.id returning version into next_version;
  perform private.bump_team_tournament();
  return private.receipt(p_request_id, (select version from public.tournament where singleton));
end;
$$;

create or replace function private.team_start_group_play(
  p_request_id uuid,
  p_expected_version integer,
  p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare tournament_row public.tournament%rowtype; fixture_id uuid; next_version integer;
begin
  select * into strict tournament_row from public.tournament where singleton for update;
  if tournament_row.version <> p_expected_version then raise exception 'Tournament version conflict' using errcode = '40001'; end if;
  if tournament_row.stage <> 'setup'
    or (select count(*) from public.teams where tournament_id = tournament_row.id) <> 4
    or (select count(*) from public.players) <> 16
    or (select count(*) from public.team_fixtures where tournament_id = tournament_row.id and stage = 'group') <> 2
    or (select count(*) from private.lineups where confirmed_at is not null) <> 12 then
    raise exception 'Valid rosters and four confirmed lineups are required' using errcode = '55000';
  end if;
  for fixture_id in select id from public.team_fixtures where tournament_id = tournament_row.id and stage = 'group'
  loop perform private.sync_fixture_matches(fixture_id); end loop;
  update public.tournament
  set stage = 'groups', setup_locked_at = clock_timestamp(),
      version = version + 1, result_revision = result_revision + 1,
      updated_at = clock_timestamp()
  where id = tournament_row.id returning version into next_version;
  return private.receipt(p_request_id, next_version);
end;
$$;

create or replace function private.team_assign_courts(
  p_request_id uuid,
  p_expected_version integer,
  p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare tournament_row public.tournament%rowtype; assignment jsonb; next_version integer;
begin
  select * into strict tournament_row from public.tournament where singleton for update;
  if tournament_row.version <> p_expected_version then raise exception 'Tournament version conflict' using errcode = '40001'; end if;
  if jsonb_typeof(p_payload -> 'assignments') <> 'array' then raise exception 'Invalid court assignments' using errcode = '22023'; end if;
  for assignment in select value from jsonb_array_elements(p_payload -> 'assignments')
  loop
    if (assignment ->> 'court')::integer not in (1, 2) then raise exception 'Court must be 1 or 2' using errcode = '22023'; end if;
    update public.matches
    set court = (assignment ->> 'court')::smallint,
        version = version + 1,
        updated_at = clock_timestamp()
    where id = (assignment ->> 'matchId')::uuid and state = 'unstarted';
    if not found then raise exception 'Only unstarted matches can be assigned' using errcode = '55000'; end if;
  end loop;
  next_version := private.bump_team_tournament();
  return private.receipt(p_request_id, next_version);
end;
$$;

create or replace function private.team_start_match(
  p_session_id uuid,
  p_request_id uuid,
  p_expected_version integer,
  p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target_match public.matches%rowtype;
  fixture public.team_fixtures%rowtype;
  tally record;
  next_match_version integer;
  next_tournament_version integer;
begin
  select * into strict target_match from public.matches
  where id = (p_payload ->> 'matchId')::uuid for update;
  select * into strict fixture from public.team_fixtures where id = target_match.fixture_id;
  if target_match.version <> p_expected_version then raise exception 'Match version conflict' using errcode = '40001'; end if;
  if target_match.state <> 'unstarted' or target_match.court is null
    or target_match.pair_a_seed1_player_id is null
    or (select count(*) from private.lineups where fixture_id = fixture.id and confirmed_at is not null) <> 6 then
    raise exception 'Match is not ready to start' using errcode = '55000';
  end if;
  if exists (select 1 from public.matches where id <> target_match.id and state = 'playing' and court = target_match.court) then
    raise exception 'Court is occupied' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.matches as playing
    where playing.id <> target_match.id and playing.state = 'playing'
      and array[
        playing.pair_a_seed1_player_id, playing.pair_a_seed2_player_id,
        playing.pair_b_seed1_player_id, playing.pair_b_seed2_player_id
      ] && array[
        target_match.pair_a_seed1_player_id, target_match.pair_a_seed2_player_id,
        target_match.pair_b_seed1_player_id, target_match.pair_b_seed2_player_id
      ]
  ) then raise exception 'A player is already playing' using errcode = '55000'; end if;
  if target_match.match_number = 3 then
    select * into tally from private.fixture_tally(fixture.id);
    if tally.wins_a <> 1 or tally.wins_b <> 1
      or (select count(*) from public.matches where fixture_id = fixture.id and match_number in (1, 2) and state = 'completed') <> 2 then
      raise exception 'Decider is not eligible' using errcode = '55000';
    end if;
  end if;
  insert into private.match_ownership (match_id, session_id)
  values (target_match.id, p_session_id)
  on conflict (match_id) do update set session_id = excluded.session_id, claimed_at = clock_timestamp();
  insert into public.match_games (match_id, game_number) values (target_match.id, 1)
  on conflict (match_id, game_number) do nothing;
  update public.matches set state = 'playing', version = version + 1, updated_at = clock_timestamp()
  where id = target_match.id returning version into next_match_version;
  next_tournament_version := private.bump_team_tournament();
  return private.receipt(p_request_id, next_tournament_version, target_match.id, next_match_version);
end;
$$;

create or replace function private.team_take_over(
  p_session_id uuid,
  p_request_id uuid,
  p_expected_version integer,
  p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_match public.matches%rowtype; previous_session uuid; next_match_version integer; next_tournament_version integer;
begin
  select * into strict target_match from public.matches where id = (p_payload ->> 'matchId')::uuid for update;
  if target_match.version <> p_expected_version then raise exception 'Match version conflict' using errcode = '40001'; end if;
  if target_match.state <> 'playing' then raise exception 'Only a playing match can be taken over' using errcode = '55000'; end if;
  select session_id into strict previous_session from private.match_ownership where match_id = target_match.id for update;
  if previous_session = p_session_id then raise exception 'Session already owns this match' using errcode = '22023'; end if;
  insert into private.scoring_handovers (match_id, from_session_id, to_session_id)
  values (target_match.id, previous_session, p_session_id);
  update private.match_ownership set session_id = p_session_id, claimed_at = clock_timestamp() where match_id = target_match.id;
  update public.matches set version = version + 1, updated_at = clock_timestamp()
  where id = target_match.id returning version into next_match_version;
  next_tournament_version := private.bump_team_tournament();
  return private.receipt(p_request_id, next_tournament_version, target_match.id, next_match_version);
end;
$$;

create or replace function private.require_match_owner(p_match_id uuid, p_session_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from private.match_ownership
    where match_id = p_match_id and session_id = p_session_id
  ) then raise exception 'This session does not own the match' using errcode = '42501'; end if;
end;
$$;

create or replace function private.team_add_point(
  p_session_id uuid,
  p_request_id uuid,
  p_expected_version integer,
  p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_match public.matches%rowtype; fixture_stage text; game public.match_games%rowtype; side text := p_payload ->> 'side'; next_match_version integer; next_tournament_version integer;
begin
  select * into strict target_match from public.matches where id = (p_payload ->> 'matchId')::uuid for update;
  if target_match.version <> p_expected_version then raise exception 'Match version conflict' using errcode = '40001'; end if;
  if target_match.state <> 'playing' or side not in ('a', 'b') then raise exception 'Point cannot be added' using errcode = '55000'; end if;
  perform private.require_match_owner(target_match.id, p_session_id);
  select fixture.stage into strict fixture_stage from public.team_fixtures as fixture where fixture.id = target_match.fixture_id;
  select * into strict game from public.match_games where match_id = target_match.id and confirmed_at is null order by game_number desc limit 1 for update;
  if private.is_game_won(game.score_a, game.score_b, fixture_stage) then raise exception 'Game is already won' using errcode = '55000'; end if;
  update public.match_games
  set score_a = score_a + case when side = 'a' then 1 else 0 end,
      score_b = score_b + case when side = 'b' then 1 else 0 end,
      updated_at = clock_timestamp()
  where id = game.id;
  update public.matches set version = version + 1, updated_at = clock_timestamp()
  where id = target_match.id returning version into next_match_version;
  next_tournament_version := private.bump_team_tournament(true);
  return private.receipt(p_request_id, next_tournament_version, target_match.id, next_match_version);
end;
$$;

create or replace function private.team_undo_point(
  p_session_id uuid,
  p_request_id uuid,
  p_expected_version integer,
  p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_match public.matches%rowtype; game public.match_games%rowtype; point_entry private.mutation_log%rowtype; next_match_version integer; next_tournament_version integer;
begin
  select * into strict target_match from public.matches where id = (p_payload ->> 'matchId')::uuid for update;
  if target_match.version <> p_expected_version then raise exception 'Match version conflict' using errcode = '40001'; end if;
  if target_match.state <> 'playing' then raise exception 'Point cannot be undone' using errcode = '55000'; end if;
  perform private.require_match_owner(target_match.id, p_session_id);
  select * into strict game from public.match_games where match_id = target_match.id and confirmed_at is null order by game_number desc limit 1 for update;
  select * into point_entry from private.mutation_log
  where actor_kind = 'staff' and operation = 'add_point' and match_id = target_match.id
    and reset_generation = private.current_reset_generation() and not undone
  order by id desc limit 1 for update;
  if not found then raise exception 'No point is available to undo' using errcode = '55000'; end if;
  if (point_entry.point_side = 'a' and game.score_a = 0) or (point_entry.point_side = 'b' and game.score_b = 0) then
    raise exception 'Point history does not match the open game' using errcode = '55000';
  end if;
  update public.match_games
  set score_a = score_a - case when point_entry.point_side = 'a' then 1 else 0 end,
      score_b = score_b - case when point_entry.point_side = 'b' then 1 else 0 end,
      updated_at = clock_timestamp()
  where id = game.id;
  update private.mutation_log set undone = true where id = point_entry.id;
  update public.matches set version = version + 1, updated_at = clock_timestamp()
  where id = target_match.id returning version into next_match_version;
  next_tournament_version := private.bump_team_tournament(true);
  return private.receipt(p_request_id, next_tournament_version, target_match.id, next_match_version);
end;
$$;

create or replace function private.team_confirm_game(
  p_session_id uuid,
  p_request_id uuid,
  p_expected_version integer,
  p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_match public.matches%rowtype; fixture_stage text; game public.match_games%rowtype; wins_a integer; wins_b integer; next_match_version integer; next_tournament_version integer;
begin
  select * into strict target_match from public.matches where id = (p_payload ->> 'matchId')::uuid for update;
  if target_match.version <> p_expected_version then raise exception 'Match version conflict' using errcode = '40001'; end if;
  if target_match.state <> 'playing' then raise exception 'Game cannot be confirmed' using errcode = '55000'; end if;
  perform private.require_match_owner(target_match.id, p_session_id);
  select fixture.stage into strict fixture_stage from public.team_fixtures as fixture where fixture.id = target_match.fixture_id;
  select * into strict game from public.match_games where match_id = target_match.id and confirmed_at is null order by game_number desc limit 1 for update;
  if not private.is_game_won(game.score_a, game.score_b, fixture_stage) then raise exception 'Game does not have a valid winning score' using errcode = '22023'; end if;
  update public.match_games set confirmed_at = clock_timestamp(), updated_at = clock_timestamp() where id = game.id;
  select count(*) filter (where score_a > score_b), count(*) filter (where score_b > score_a)
  into wins_a, wins_b from public.match_games where match_id = target_match.id and confirmed_at is not null;
  if greatest(wins_a, wins_b) = 2 then
    update public.matches
    set state = 'completed', result_kind = 'played',
        winner_side = case when wins_a = 2 then 'a' else 'b' end,
        court = null, version = version + 1, updated_at = clock_timestamp()
    where id = target_match.id returning version into next_match_version;
    delete from private.match_ownership where match_id = target_match.id;
    perform private.finish_fixture_if_decided(target_match.fixture_id);
  else
    insert into public.match_games (match_id, game_number) values (target_match.id, game.game_number + 1);
    update public.matches set version = version + 1, updated_at = clock_timestamp()
    where id = target_match.id returning version into next_match_version;
  end if;
  next_tournament_version := private.bump_team_tournament();
  return private.receipt(p_request_id, next_tournament_version, target_match.id, next_match_version);
end;
$$;

create or replace function private.team_mark_walkover(
  p_request_id uuid,
  p_expected_version integer,
  p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_match public.matches%rowtype; side text := p_payload ->> 'winnerSide'; tally record; next_match_version integer; next_tournament_version integer;
begin
  select * into strict target_match from public.matches where id = (p_payload ->> 'matchId')::uuid for update;
  if target_match.version <> p_expected_version then raise exception 'Match version conflict' using errcode = '40001'; end if;
  if target_match.state not in ('unstarted', 'playing') or side not in ('a', 'b')
    or exists (select 1 from public.match_games where match_id = target_match.id and (score_a <> 0 or score_b <> 0 or confirmed_at is not null)) then
    raise exception 'Walkover requires an unscored match and one winner' using errcode = '55000';
  end if;
  if target_match.match_number = 3 then
    select * into tally from private.fixture_tally(target_match.fixture_id);
    if tally.wins_a <> 1 or tally.wins_b <> 1
      or (select count(*) from public.matches where fixture_id = target_match.fixture_id and match_number in (1, 2) and state = 'completed') <> 2 then
      raise exception 'Decider is not eligible' using errcode = '55000';
    end if;
  end if;
  delete from public.match_games where match_id = target_match.id;
  delete from private.match_ownership where match_id = target_match.id;
  update public.matches set state = 'completed', result_kind = 'walkover', winner_side = side,
    court = null, version = version + 1, updated_at = clock_timestamp()
  where id = target_match.id returning version into next_match_version;
  perform private.finish_fixture_if_decided(target_match.fixture_id);
  next_tournament_version := private.bump_team_tournament();
  return private.receipt(p_request_id, next_tournament_version, target_match.id, next_match_version);
end;
$$;

create or replace function private.team_correction_block_code(
  p_match_id uuid,
  p_new_winner_side text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_match public.matches%rowtype;
  fixture public.team_fixtures%rowtype;
  current_winner_team uuid;
  proposed_winner_team uuid;
  wins_a integer;
  wins_b integer;
  other_winner text;
begin
  if (select stage from public.tournament where singleton) = 'completed' then
    return 'tournament-completed';
  end if;
  select * into target_match from public.matches where id = p_match_id;
  if not found or target_match.state <> 'completed' or p_new_winner_side not in ('a', 'b') then
    return 'invalid-match-state';
  end if;
  select * into strict fixture from public.team_fixtures where id = target_match.fixture_id;
  if fixture.stage <> 'group' then return null; end if;

  if target_match.match_number in (1, 2) then
    select winner_side into other_winner from public.matches
    where fixture_id = fixture.id
      and match_number in (1, 2)
      and match_number <> target_match.match_number
      and state = 'completed';
    if other_winner = p_new_winner_side and exists (
      select 1 from public.matches
      where fixture_id = fixture.id and match_number = 3
        and state in ('playing', 'completed')
    ) then return 'decider-started'; end if;
  end if;

  current_winner_team := private.fixture_winner_team_id(fixture.id);
  select count(*) filter (where winner_side = 'a'),
         count(*) filter (where winner_side = 'b')
  into wins_a, wins_b
  from public.matches
  where fixture_id = fixture.id and state = 'completed' and id <> target_match.id;
  wins_a := wins_a + case when p_new_winner_side = 'a' then 1 else 0 end;
  wins_b := wins_b + case when p_new_winner_side = 'b' then 1 else 0 end;
  proposed_winner_team := case
    when wins_a >= 2 then fixture.team_a_id
    when wins_b >= 2 then fixture.team_b_id
    else null
  end;
  if current_winner_team is distinct from proposed_winner_team and exists (
    select 1 from public.matches as placement_match
    join public.team_fixtures as placement on placement.id = placement_match.fixture_id
    where placement.tournament_id = fixture.tournament_id
      and placement.stage <> 'group'
      and placement_match.state in ('playing', 'completed')
  ) then return 'placement-started'; end if;
  return null;
end;
$$;

create or replace function private.apply_team_correction(
  p_match_id uuid,
  p_winner_side text,
  p_games jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_match public.matches%rowtype;
  fixture_stage text;
  fixture_tally record;
  game_data jsonb;
  game_number integer := 0;
  score_a integer;
  score_b integer;
  wins_a integer := 0;
  wins_b integer := 0;
  next_match_version integer;
begin
  select * into strict target_match from public.matches where id = p_match_id for update;
  select fixture.stage into strict fixture_stage from public.team_fixtures as fixture where fixture.id = target_match.fixture_id;
  if p_winner_side not in ('a', 'b') or jsonb_typeof(p_games) <> 'array'
    or jsonb_array_length(p_games) not between 2 and 3 then
    raise exception 'A corrected result requires two or three games and one winner' using errcode = '22023';
  end if;
  delete from public.match_games where match_id = target_match.id;
  for game_data in select value from jsonb_array_elements(p_games)
  loop
    game_number := game_number + 1;
    score_a := (game_data ->> 'a')::integer;
    score_b := (game_data ->> 'b')::integer;
    if not private.is_game_won(score_a, score_b, fixture_stage) or greatest(wins_a, wins_b) = 2 then
      raise exception 'Corrected games contain an invalid score or an extra game' using errcode = '22023';
    end if;
    wins_a := wins_a + case when score_a > score_b then 1 else 0 end;
    wins_b := wins_b + case when score_b > score_a then 1 else 0 end;
    insert into public.match_games (match_id, game_number, score_a, score_b, confirmed_at)
    values (target_match.id, game_number, score_a, score_b, clock_timestamp());
  end loop;
  if (p_winner_side = 'a' and wins_a <> 2) or (p_winner_side = 'b' and wins_b <> 2)
    or greatest(wins_a, wins_b) <> 2 then
    raise exception 'Corrected winner does not match the games' using errcode = '22023';
  end if;
  delete from private.match_ownership where match_id = target_match.id;
  update public.matches
  set state = 'completed', result_kind = 'played', winner_side = p_winner_side,
      court = null, version = version + 1, updated_at = clock_timestamp()
  where id = target_match.id returning version into next_match_version;
  if fixture_stage = 'group' then
    select * into fixture_tally from private.fixture_tally(target_match.fixture_id);
    if fixture_tally.wins_a = 1 and fixture_tally.wins_b = 1 then
      update public.matches
      set state = 'unstarted', version = version + 1, updated_at = clock_timestamp()
      where fixture_id = target_match.fixture_id and match_number = 3 and state = 'unnecessary';
    elsif greatest(fixture_tally.wins_a, fixture_tally.wins_b) >= 2 then
      update public.matches
      set state = 'unnecessary', court = null, version = version + 1, updated_at = clock_timestamp()
      where fixture_id = target_match.fixture_id and match_number = 3 and state = 'unstarted';
    end if;
  end if;
  perform private.finish_fixture_if_decided(target_match.fixture_id);
  perform private.populate_placement_fixtures();
  return next_match_version;
end;
$$;

create or replace function private.team_correct_result(
  p_request_id uuid,
  p_expected_version integer,
  p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_match public.matches%rowtype; block_code text; next_match_version integer; next_tournament_version integer;
begin
  select * into strict target_match from public.matches where id = (p_payload ->> 'matchId')::uuid for update;
  if target_match.version <> p_expected_version then raise exception 'Match version conflict' using errcode = '40001'; end if;
  if (p_payload ->> 'previewTournamentVersion')::integer is distinct from (select result_revision from public.tournament where singleton) then
    raise exception 'Reviewed result impact is stale' using errcode = '40001';
  end if;
  block_code := private.team_correction_block_code(target_match.id, p_payload ->> 'winnerSide');
  if block_code is not null then raise exception '%', block_code using errcode = '55000'; end if;
  next_match_version := private.apply_team_correction(target_match.id, p_payload ->> 'winnerSide', p_payload -> 'games');
  next_tournament_version := private.bump_team_tournament();
  return private.receipt(p_request_id, next_tournament_version, target_match.id, next_match_version);
end;
$$;

create or replace function public.preview_result_correction(
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
  target_match public.matches%rowtype;
  block_code text;
  before_body jsonb;
  after_body jsonb;
  current_revision integer;
begin
  perform private.require_organizer();
  perform private.lock_mutations();
  perform private.require_reset_generation(p_reset_generation);
  select * into strict target_match from public.matches where id = (p_payload ->> 'matchId')::uuid;
  if target_match.version <> p_expected_version then raise exception 'Match version conflict' using errcode = '40001'; end if;
  select result_revision into strict current_revision from public.tournament where singleton;
  block_code := private.team_correction_block_code(target_match.id, p_payload ->> 'winnerSide');
  before_body := private.snapshot_body();
  if block_code is null then
    begin
      perform private.apply_team_correction(target_match.id, p_payload ->> 'winnerSide', p_payload -> 'games');
      after_body := private.snapshot_body();
      raise exception 'rollback-team-correction-preview' using errcode = 'P0001';
    exception when raise_exception then
      if sqlerrm <> 'rollback-team-correction-preview' then raise; end if;
    end;
  end if;
  return jsonb_build_object(
    'requestId', p_request_id,
    'tournamentVersion', current_revision,
    'blockedReason', block_code,
    'before', before_body,
    'after', case when block_code is null then after_body else null end
  );
end;
$$;

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
  if p_operation in ('start_match', 'take_over', 'add_point', 'undo_point', 'confirm_game') then
    staff_session := private.require_scorer();
  else
    staff_session := private.require_organizer();
  end if;
  perform private.lock_mutations();
  perform private.require_reset_generation(p_reset_generation);
  replay := private.replay_mutation(staff_session, p_request_id, p_operation, p_expected_version, p_payload);
  if replay is not null then return replay; end if;

  response := case p_operation
    when 'save_roster' then private.team_save_roster(p_request_id, p_expected_version, p_payload)
    when 'save_lineup' then private.team_save_lineup(p_request_id, p_expected_version, p_payload)
    when 'confirm_lineup' then private.team_confirm_lineup(p_request_id, p_expected_version, p_payload)
    when 'reopen_lineups' then private.team_reopen_lineups(p_request_id, p_expected_version, p_payload)
    when 'start_group_play' then private.team_start_group_play(p_request_id, p_expected_version, p_payload)
    when 'assign_courts' then private.team_assign_courts(p_request_id, p_expected_version, p_payload)
    when 'start_match' then private.team_start_match(staff_session, p_request_id, p_expected_version, p_payload)
    when 'take_over' then private.team_take_over(staff_session, p_request_id, p_expected_version, p_payload)
    when 'add_point' then private.team_add_point(staff_session, p_request_id, p_expected_version, p_payload)
    when 'undo_point' then private.team_undo_point(staff_session, p_request_id, p_expected_version, p_payload)
    when 'confirm_game' then private.team_confirm_game(staff_session, p_request_id, p_expected_version, p_payload)
    when 'mark_walkover' then private.team_mark_walkover(p_request_id, p_expected_version, p_payload)
    when 'correct_result' then private.team_correct_result(p_request_id, p_expected_version, p_payload)
    else null
  end;
  if response is null then raise exception 'Unknown tournament mutation' using errcode = '22023'; end if;
  return private.store_mutation(
    staff_session, p_request_id, p_operation, p_expected_version, p_payload,
    response, target_match_id,
    case when p_operation = 'add_point' then p_payload ->> 'side' else null end
  );
end;
$$;

create function public.save_roster(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_team_mutation('save_roster', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create function public.save_lineup(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_team_mutation('save_lineup', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create function public.confirm_lineup(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_team_mutation('confirm_lineup', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create function public.reopen_lineups(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_team_mutation('reopen_lineups', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create function public.start_group_play(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_team_mutation('start_group_play', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create function public.assign_courts(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_team_mutation('assign_courts', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create function public.start_match(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_team_mutation('start_match', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create function public.take_over(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_team_mutation('take_over', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create function public.add_point(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_team_mutation('add_point', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create function public.undo_point(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_team_mutation('undo_point', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create function public.confirm_game(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_team_mutation('confirm_game', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create function public.mark_walkover(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_team_mutation('mark_walkover', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;
create function public.correct_result(p_request_id uuid, p_reset_generation integer, p_expected_version integer, p_payload jsonb) returns jsonb language sql security definer set search_path = '' as $$ select private.invoke_team_mutation('correct_result', p_request_id, p_reset_generation, p_expected_version, p_payload); $$;

create or replace function public.get_score_access(p_match_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_staff_access(private.request_session_id(), auth.uid())
    and exists (
      select 1 from private.match_ownership
      where match_id = p_match_id and session_id = private.request_session_id()
    );
$$;

revoke all on all functions in schema private from public, anon, authenticated, service_role;
revoke all on function public.preview_result_correction(uuid, integer, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.save_roster(uuid, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.save_lineup(uuid, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.confirm_lineup(uuid, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.reopen_lineups(uuid, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.start_group_play(uuid, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.assign_courts(uuid, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.start_match(uuid, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.take_over(uuid, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.add_point(uuid, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.undo_point(uuid, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.confirm_game(uuid, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.mark_walkover(uuid, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.correct_result(uuid, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.get_score_access(uuid) from public, anon, authenticated;
grant execute on function public.preview_result_correction(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.save_roster(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.save_lineup(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.confirm_lineup(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.reopen_lineups(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.start_group_play(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.assign_courts(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.start_match(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.take_over(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.add_point(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.undo_point(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.confirm_game(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.mark_walkover(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.correct_result(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.get_score_access(uuid) to authenticated;

-- Maintenance reset now targets the team model and fixed two-court schedule.
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
  delete from private.scoring_handovers;
  delete from private.match_ownership;
  if p_mode = 'progress' then
    delete from public.match_games;
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
