-- Replace declared lineups with per-match pair assignment, restructure the
-- third-place fixture, and resolve qualification playoffs in numbered rounds.
--
-- Nothing has been played. Tournament identity, rosters, seeds, fixtures,
-- matches, and court schedules are retained; lineups, confirmations, and match
-- players are deleted. Reverting this code cannot restore the deleted lineups.

do $$
begin
  if exists (select 1 from public.matches where state <> 'unstarted') then
    raise exception 'Pair assignment migration requires that no match has started'
      using errcode = '55000';
  end if;
end;
$$;

-- Schema --------------------------------------------------------------------

do $$
declare
  constraint_name text;
  dropped integer := 0;
begin
  -- The unnamed all-or-nothing check from the team schema kept one side from
  -- being saved before the other.
  for constraint_name in
    select con.conname
    from pg_catalog.pg_constraint as con
    where con.conrelid = 'public.matches'::regclass
      and con.contype = 'c'
      and pg_catalog.pg_get_constraintdef(con.oid) like '%pair_a_player_1_id IS NULL%'
      and pg_catalog.pg_get_constraintdef(con.oid) like '%pair_b_player_2_id IS NOT NULL%'
  loop
    execute format('alter table public.matches drop constraint %I', constraint_name);
    dropped := dropped + 1;
  end loop;
  if dropped <> 1 then
    raise exception 'Expected one all-or-nothing match pair constraint, found %', dropped;
  end if;
end;
$$;

update public.matches
set pair_a_player_1_id = null,
    pair_a_player_2_id = null,
    pair_b_player_1_id = null,
    pair_b_player_2_id = null,
    version = version + 1,
    updated_at = clock_timestamp()
where pair_a_player_1_id is not null or pair_b_player_1_id is not null;

alter table public.matches
  add constraint matches_pair_a_complete_check
    check ((pair_a_player_1_id is null) = (pair_a_player_2_id is null)),
  add constraint matches_pair_b_complete_check
    check ((pair_b_player_1_id is null) = (pair_b_player_2_id is null));

create table public.qualification_playoff_rounds (
  id uuid primary key default extensions.gen_random_uuid(),
  tournament_id uuid not null references public.tournament (id) on delete cascade,
  round_number integer not null check (round_number > 0),
  team_ids uuid[] not null check (cardinality(team_ids) between 2 and 4),
  fixed_finalist_ids uuid[] not null default array[]::uuid[],
  available_places integer not null check (available_places in (1, 2)),
  created_at timestamptz not null default now(),
  unique (tournament_id, round_number)
);

alter table public.team_fixtures
  add column playoff_round_id uuid
    references public.qualification_playoff_rounds (id) on delete set null,
  add constraint team_fixtures_playoff_round_stage_check
    check (playoff_round_id is null or stage = 'qualification-playoff');
create index team_fixtures_playoff_round_id_idx
  on public.team_fixtures (playoff_round_id);

alter table public.tournament
  add column current_playoff_round_id uuid
    references public.qualification_playoff_rounds (id) on delete set null;

alter table public.qualification_playoff_rounds enable row level security;
create policy qualification_playoff_rounds_public_read
  on public.qualification_playoff_rounds
  for select to anon, authenticated using (true);
grant select on public.qualification_playoff_rounds to anon, authenticated;
revoke insert, update, delete, truncate on public.qualification_playoff_rounds
  from anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'qualification_playoff_rounds'
  ) then
    alter publication supabase_realtime add table public.qualification_playoff_rounds;
  end if;
end;
$$;

-- Helpers -------------------------------------------------------------------

create function private.sorted_uuids(p_ids uuid[])
returns uuid[]
language sql
immutable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct id order by id), array[]::uuid[])
  from unnest(p_ids) as input(id);
$$;

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
  target integer := case p_stage
    when 'qualification-playoff' then 11
    when 'third-place' then 15
    else 21
  end;
  cap integer := case p_stage
    when 'qualification-playoff' then 15
    when 'third-place' then 21
    else 30
  end;
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

create or replace function private.games_to_win(p_stage text)
returns integer
language sql
immutable
security definer
set search_path = ''
as $$
  select case when p_stage in ('third-place', 'final') then 2 else 1 end;
$$;

-- Matches exist once a fixture's participants are known. Pairs are saved per
-- match side through assign_pair, never copied from a declaration.
create or replace function private.sync_fixture_matches(p_fixture_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  fixture public.team_fixtures%rowtype;
begin
  select * into strict fixture
  from public.team_fixtures
  where id = p_fixture_id
  for update;

  if fixture.team_a_id is null or fixture.team_b_id is null then
    raise exception 'Fixture participants are not assigned' using errcode = '55000';
  end if;

  insert into public.matches (fixture_id, match_number)
  select fixture.id, match_number
  from generate_series(1, case
    when fixture.stage = 'qualifying' then 2
    when fixture.stage = 'qualification-playoff' then 1
    else 3
  end) as match_number
  on conflict (fixture_id, match_number) do nothing;
end;
$$;

-- Releases rounds from p_from_round onward. Their fixtures stay as unassigned
-- slots, with their matches and courts, for the next round to reuse.
create function private.release_playoff_rounds(
  p_tournament_id uuid,
  p_from_round integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  released_round_ids uuid[];
  released_fixture_ids uuid[];
begin
  select coalesce(array_agg(round.id), array[]::uuid[])
  into released_round_ids
  from public.qualification_playoff_rounds as round
  where round.tournament_id = p_tournament_id
    and round.round_number >= p_from_round;
  if cardinality(released_round_ids) = 0 then return; end if;

  select coalesce(array_agg(fixture.id), array[]::uuid[])
  into released_fixture_ids
  from public.team_fixtures as fixture
  where fixture.playoff_round_id = any(released_round_ids);

  delete from public.match_games as game
  using public.matches as match
  where game.match_id = match.id
    and match.fixture_id = any(released_fixture_ids);
  delete from private.match_ownership as ownership
  using public.matches as match
  where ownership.match_id = match.id
    and match.fixture_id = any(released_fixture_ids);
  update public.matches
  set state = 'unstarted', result_kind = null, winner_side = null,
      pair_a_player_1_id = null, pair_a_player_2_id = null,
      pair_b_player_1_id = null, pair_b_player_2_id = null,
      version = version + 1, updated_at = clock_timestamp()
  where fixture_id = any(released_fixture_ids);
  update public.team_fixtures
  set team_a_id = null, team_b_id = null, playoff_round_id = null,
      version = version + 1, updated_at = clock_timestamp()
  where id = any(released_fixture_ids);
  update public.tournament
  set current_playoff_round_id = null, updated_at = clock_timestamp()
  where id = p_tournament_id
    and current_playoff_round_id = any(released_round_ids);
  delete from public.qualification_playoff_rounds
  where id = any(released_round_ids);
end;
$$;

-- Creates one round and its fixtures, reusing released slots first. A
-- two-team round is one match, a three-team round a mini round robin, and a
-- four-team round two matchups the supervised draw fills in.
create function private.create_playoff_round(
  p_tournament_id uuid,
  p_round_number integer,
  p_team_ids uuid[],
  p_fixed_finalist_ids uuid[],
  p_available_places integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  round_id uuid;
  team_count integer := cardinality(p_team_ids);
  fixture_count integer;
  slot_id uuid;
  team_a uuid;
  team_b uuid;
  fixture_index integer;
begin
  fixture_count := case team_count when 2 then 1 when 3 then 3 when 4 then 2 end;
  if fixture_count is null then
    raise exception 'Invalid playoff round' using errcode = '22023';
  end if;

  insert into public.qualification_playoff_rounds (
    tournament_id, round_number, team_ids, fixed_finalist_ids, available_places
  ) values (
    p_tournament_id, p_round_number, p_team_ids, p_fixed_finalist_ids,
    p_available_places
  ) returning id into round_id;

  for fixture_index in 1..fixture_count loop
    team_a := case team_count
      when 2 then p_team_ids[1]
      when 3 then (array[p_team_ids[1], p_team_ids[1], p_team_ids[2]])[fixture_index]
      else null
    end;
    team_b := case team_count
      when 2 then p_team_ids[2]
      when 3 then (array[p_team_ids[2], p_team_ids[3], p_team_ids[3]])[fixture_index]
      else null
    end;

    select id into slot_id
    from public.team_fixtures
    where tournament_id = p_tournament_id
      and stage = 'qualification-playoff'
      and playoff_round_id is null
    order by created_at, id
    limit 1
    for update;

    if slot_id is null then
      insert into public.team_fixtures (
        tournament_id, stage, team_a_id, team_b_id, playoff_round_id
      ) values (
        p_tournament_id, 'qualification-playoff', team_a, team_b, round_id
      ) returning id into slot_id;
    else
      update public.team_fixtures
      set team_a_id = team_a, team_b_id = team_b, playoff_round_id = round_id,
          version = version + 1, updated_at = clock_timestamp()
      where id = slot_id;
      -- A reused slot starts clean whatever happened to it while released;
      -- only its court carries over.
      delete from public.match_games as game
      using public.matches as match
      where game.match_id = match.id and match.fixture_id = slot_id;
      delete from private.match_ownership as ownership
      using public.matches as match
      where ownership.match_id = match.id and match.fixture_id = slot_id;
      update public.matches
      set state = 'unstarted', result_kind = null, winner_side = null,
          pair_a_player_1_id = null, pair_a_player_2_id = null,
          pair_b_player_1_id = null, pair_b_player_2_id = null,
          version = version + 1, updated_at = clock_timestamp()
      where fixture_id = slot_id;
    end if;

    if team_a is not null then
      perform private.sync_fixture_matches(slot_id);
    end if;
    slot_id := null;
  end loop;

  update public.tournament
  set current_playoff_round_id = round_id, updated_at = clock_timestamp()
  where id = p_tournament_id;
  return round_id;
end;
$$;

-- Unassigns both placement fixtures and clears their unstarted pairs.
create function private.clear_placement_participants(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.matches as match
  set pair_a_player_1_id = null, pair_a_player_2_id = null,
      pair_b_player_1_id = null, pair_b_player_2_id = null,
      version = match.version + 1, updated_at = clock_timestamp()
  from public.team_fixtures as placement
  where match.fixture_id = placement.id
    and placement.tournament_id = p_tournament_id
    and placement.stage in ('third-place', 'final')
    and match.state = 'unstarted'
    and (match.pair_a_player_1_id is not null or match.pair_b_player_1_id is not null);
  update public.team_fixtures
  set team_a_id = null, team_b_id = null, version = version + 1,
      updated_at = clock_timestamp()
  where tournament_id = p_tournament_id
    and stage in ('third-place', 'final')
    and (team_a_id is not null or team_b_id is not null);
  update public.tournament
  set finalists_confirmed_at = null, updated_at = clock_timestamp()
  where id = p_tournament_id and finalists_confirmed_at is not null;
end;
$$;

-- Qualification progression ------------------------------------------------

-- Mirrors resolvePlayoffRound in src/domain/playoff-rounds.ts. Each stored
-- round must equal the round its predecessor's results call for; the first
-- mismatch releases that round and everything after it and creates the
-- expected one, so a correction rebuilds only unstarted continuation state.
create or replace function private.populate_placement_fixtures()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tournament_id uuid;
  cutoff_rank integer;
  fixed_finalists uuid[];
  tied_teams uuid[];
  finalist_ids uuid[];
  nonfinalist_ids uuid[];
  available_places integer;
  placement_started boolean;
  participants_changed boolean;
  round_row public.qualification_playoff_rounds%rowtype;
  current_round_number integer := 1;
  expected_teams uuid[];
  expected_fixed uuid[];
  expected_places integer;
  round_fixture_count integer;
  round_winner_ids uuid[];
  automatic_ids uuid[];
  candidate_ids uuid[];
begin
  select id into target_tournament_id from public.tournament where singleton;
  if target_tournament_id is null then return; end if;

  if exists (
    select 1
    from public.team_fixtures as fixture
    join public.matches as match on match.fixture_id = fixture.id
    where fixture.tournament_id = target_tournament_id
      and fixture.stage = 'qualifying'
      and match.state not in ('completed', 'unnecessary')
  ) or (
    select count(*)
    from public.matches as match
    join public.team_fixtures as fixture on fixture.id = match.fixture_id
    where fixture.tournament_id = target_tournament_id
      and fixture.stage = 'qualifying'
  ) <> 12 then
    return;
  end if;

  select standings.rank into cutoff_rank
  from private.qualifying_standings() as standings
  order by standings.rank, standings.team_id
  offset 1 limit 1;

  select coalesce(array_agg(team_id order by team_id), array[]::uuid[])
  into fixed_finalists
  from private.qualifying_standings()
  where rank < cutoff_rank;

  select coalesce(array_agg(team_id order by team_id), array[]::uuid[])
  into tied_teams
  from private.qualifying_standings()
  where rank = cutoff_rank;

  available_places := 2 - cardinality(fixed_finalists);
  if cardinality(tied_teams) <= available_places then
    perform private.release_playoff_rounds(target_tournament_id, 1);
    finalist_ids := fixed_finalists || tied_teams;
  else
    expected_teams := tied_teams;
    expected_fixed := fixed_finalists;
    expected_places := available_places;
    loop
      select * into round_row
      from public.qualification_playoff_rounds
      where tournament_id = target_tournament_id
        and round_number = current_round_number;

      if not found
        or round_row.team_ids <> expected_teams
        or round_row.fixed_finalist_ids <> expected_fixed
        or round_row.available_places <> expected_places then
        perform private.release_playoff_rounds(
          target_tournament_id, current_round_number
        );
        perform private.create_playoff_round(
          target_tournament_id, current_round_number,
          expected_teams, expected_fixed, expected_places
        );
        perform private.clear_placement_participants(target_tournament_id);
        return;
      end if;

      update public.tournament
      set current_playoff_round_id = round_row.id, updated_at = clock_timestamp()
      where id = target_tournament_id
        and current_playoff_round_id is distinct from round_row.id;

      select count(*),
             array_agg(private.fixture_winner_team_id(fixture.id) order by fixture.id)
               filter (where fixture.team_a_id is not null
                 and fixture.team_b_id is not null
                 and private.fixture_winner_team_id(fixture.id) is not null)
      into round_fixture_count, round_winner_ids
      from public.team_fixtures as fixture
      where fixture.playoff_round_id = round_row.id;

      if round_fixture_count = 0
        or coalesce(cardinality(round_winner_ids), 0) <> round_fixture_count then
        perform private.release_playoff_rounds(
          target_tournament_id, current_round_number + 1
        );
        return;
      end if;

      if cardinality(round_row.team_ids) in (2, 4) then
        finalist_ids := round_row.fixed_finalist_ids || round_winner_ids;
        perform private.release_playoff_rounds(
          target_tournament_id, current_round_number + 1
        );
        exit;
      end if;

      with round_matches as (
        select fixture.team_a_id,
               fixture.team_b_id,
               match.winner_side,
               case when match.result_kind = 'played'
                 then coalesce(sum(game.score_a), 0) else 0 end::integer as points_a,
               case when match.result_kind = 'played'
                 then coalesce(sum(game.score_b), 0) else 0 end::integer as points_b
        from public.team_fixtures as fixture
        join public.matches as match on match.fixture_id = fixture.id
        left join public.match_games as game
          on game.match_id = match.id and game.confirmed_at is not null
        where fixture.playoff_round_id = round_row.id
          and match.state = 'completed'
        group by fixture.team_a_id, fixture.team_b_id, match.id,
                 match.winner_side, match.result_kind
      ), round_standings as (
        select entrant.team_id,
               count(*) filter (
                 where (match.team_a_id = entrant.team_id and match.winner_side = 'a')
                    or (match.team_b_id = entrant.team_id and match.winner_side = 'b')
               )::integer as wins,
               coalesce(sum(case when match.team_a_id = entrant.team_id
                 then match.points_a - match.points_b
                 else match.points_b - match.points_a end), 0)::integer as point_difference,
               coalesce(sum(case when match.team_a_id = entrant.team_id
                 then match.points_a else match.points_b end), 0)::integer as points_scored
        from unnest(round_row.team_ids) as entrant(team_id)
        left join round_matches as match
          on entrant.team_id in (match.team_a_id, match.team_b_id)
        group by entrant.team_id
      ), ranked as (
        select *, rank() over (
          order by wins desc, point_difference desc, points_scored desc
        ) as round_rank
        from round_standings
      ), cutoff as (
        select round_rank
        from ranked
        order by round_rank, team_id
        offset round_row.available_places - 1 limit 1
      )
      select coalesce(array_agg(team_id order by team_id) filter (
               where round_rank < (select round_rank from cutoff)
             ), array[]::uuid[]),
             coalesce(array_agg(team_id order by team_id) filter (
               where round_rank = (select round_rank from cutoff)
             ), array[]::uuid[])
      into automatic_ids, candidate_ids
      from ranked;

      expected_fixed := private.sorted_uuids(round_row.fixed_finalist_ids || automatic_ids);
      expected_places := round_row.available_places - cardinality(automatic_ids);
      if cardinality(candidate_ids) > expected_places then
        expected_teams := candidate_ids;
        current_round_number := current_round_number + 1;
      else
        finalist_ids := expected_fixed || candidate_ids;
        perform private.release_playoff_rounds(
          target_tournament_id, current_round_number + 1
        );
        exit;
      end if;
    end loop;
  end if;

  finalist_ids := private.sorted_uuids(finalist_ids);

  select exists (
    select 1
    from public.matches as match
    join public.team_fixtures as fixture on fixture.id = match.fixture_id
    where fixture.tournament_id = target_tournament_id
      and fixture.stage in ('third-place', 'final')
      and match.state <> 'unstarted'
  ) into placement_started;
  if placement_started then return; end if;

  select array_agg(team.id order by team.id)
  into nonfinalist_ids
  from public.teams as team
  where team.tournament_id = target_tournament_id
    and team.id <> all(finalist_ids);

  select exists (
    select 1
    from public.team_fixtures as placement
    where placement.tournament_id = target_tournament_id
      and (
        (placement.stage = 'final' and (
          placement.team_a_id is distinct from finalist_ids[1]
          or placement.team_b_id is distinct from finalist_ids[2]
        ))
        or
        (placement.stage = 'third-place' and (
          placement.team_a_id is distinct from nonfinalist_ids[1]
          or placement.team_b_id is distinct from nonfinalist_ids[2]
        ))
      )
  ) into participants_changed;

  -- A fixture whose participants change loses both saved pairs; an unchanged
  -- fixture keeps them.
  update public.matches as match
  set pair_a_player_1_id = null, pair_a_player_2_id = null,
      pair_b_player_1_id = null, pair_b_player_2_id = null,
      version = match.version + 1, updated_at = clock_timestamp()
  from public.team_fixtures as placement
  where match.fixture_id = placement.id
    and placement.tournament_id = target_tournament_id
    and placement.stage in ('third-place', 'final')
    and match.state = 'unstarted'
    and (match.pair_a_player_1_id is not null or match.pair_b_player_1_id is not null)
    and (placement.team_a_id, placement.team_b_id) is distinct from (
      case when placement.stage = 'final' then finalist_ids[1] else nonfinalist_ids[1] end,
      case when placement.stage = 'final' then finalist_ids[2] else nonfinalist_ids[2] end
    );

  update public.team_fixtures
  set team_a_id = case when stage = 'final' then finalist_ids[1] else nonfinalist_ids[1] end,
      team_b_id = case when stage = 'final' then finalist_ids[2] else nonfinalist_ids[2] end,
      version = version + 1,
      updated_at = clock_timestamp()
  where tournament_id = target_tournament_id
    and stage in ('third-place', 'final')
    and (team_a_id, team_b_id) is distinct from (
      case when stage = 'final' then finalist_ids[1] else nonfinalist_ids[1] end,
      case when stage = 'final' then finalist_ids[2] else nonfinalist_ids[2] end
    );
  if participants_changed then
    update public.tournament
    set finalists_confirmed_at = null, updated_at = clock_timestamp()
    where id = target_tournament_id;
  end if;
end;
$$;

-- Pair assignment -----------------------------------------------------------

create function private.team_assign_pair(
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
  target_match public.matches%rowtype;
  fixture public.team_fixtures%rowtype;
  tournament_row public.tournament%rowtype;
  target_side text := p_payload ->> 'side';
  player_1 uuid := (p_payload ->> 'player1Id')::uuid;
  player_2 uuid := (p_payload ->> 'player2Id')::uuid;
  rule_exception boolean := coalesce((p_payload ->> 'ruleException')::boolean, false);
  target_team uuid;
  next_match_version integer;
  next_tournament_version integer;
begin
  if target_side is null or target_side not in ('a', 'b')
    or player_1 is null or player_2 is null then
    raise exception 'Invalid pair assignment' using errcode = '22023';
  end if;
  if rule_exception and private.staff_role() is distinct from 'organizer' then
    raise exception 'Organizer access required' using errcode = '42501';
  end if;

  select * into strict target_match
  from public.matches
  where id = (p_payload ->> 'matchId')::uuid
  for update;
  select * into strict fixture
  from public.team_fixtures where id = target_match.fixture_id;
  select * into strict tournament_row
  from public.tournament where id = fixture.tournament_id;

  if target_match.version <> p_expected_version then
    raise exception 'Match version conflict' using errcode = '40001';
  end if;
  if target_match.state <> 'unstarted' then
    raise exception 'Pairs are fixed after the match starts' using errcode = '55000';
  end if;
  target_team := case when target_side = 'a' then fixture.team_a_id else fixture.team_b_id end;
  if tournament_row.stage = 'setup' or target_team is null
    or (fixture.stage in ('third-place', 'final')
      and tournament_row.finalists_confirmed_at is null) then
    raise exception 'Pair assignment is not open for this match' using errcode = '55000';
  end if;

  if player_1 = player_2 then
    raise exception 'A pair requires two distinct players' using errcode = '22023';
  end if;
  if (select count(*) from public.players
      where team_id = target_team and id in (player_1, player_2)) <> 2 then
    raise exception 'Pair players must belong to the team' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.matches as playing
    where playing.state = 'playing'
      and array[
        playing.pair_a_player_1_id, playing.pair_a_player_2_id,
        playing.pair_b_player_1_id, playing.pair_b_player_2_id
      ] && array[player_1, player_2]
  ) then
    raise exception 'A player is already playing' using errcode = '55000';
  end if;

  if not rule_exception then
    if (fixture.stage = 'qualifying'
        or (fixture.stage = 'third-place' and target_match.match_number < 3))
      and (select count(distinct seed) from public.players
           where id in (player_1, player_2)) <> 2 then
      raise exception 'Pair must mix seeds' using errcode = '22023';
    end if;
    if fixture.stage = 'qualifying' and exists (
      select 1 from public.matches as sibling
      where sibling.fixture_id = fixture.id
        and sibling.id <> target_match.id
        and (case when target_side = 'a'
          then array[sibling.pair_a_player_1_id, sibling.pair_a_player_2_id]
          else array[sibling.pair_b_player_1_id, sibling.pair_b_player_2_id]
        end) && array[player_1, player_2]
    ) then
      raise exception 'Player already plays in this fixture' using errcode = '22023';
    end if;
  end if;

  update public.matches
  set pair_a_player_1_id = case when target_side = 'a' then player_1 else pair_a_player_1_id end,
      pair_a_player_2_id = case when target_side = 'a' then player_2 else pair_a_player_2_id end,
      pair_b_player_1_id = case when target_side = 'b' then player_1 else pair_b_player_1_id end,
      pair_b_player_2_id = case when target_side = 'b' then player_2 else pair_b_player_2_id end,
      version = version + 1,
      updated_at = clock_timestamp()
  where id = target_match.id
  returning version into next_match_version;
  next_tournament_version := private.bump_team_tournament();
  return private.receipt(
    p_request_id, next_tournament_version, target_match.id, next_match_version
  );
end;
$$;

-- Organizer commands -------------------------------------------------------

-- Only the four-team matchup draw remains; advancement is never drawn.
create or replace function private.team_record_draw(
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
  round_row public.qualification_playoff_rounds%rowtype;
  round_fixture_ids uuid[];
  supplied_teams uuid[];
  supplied_fixtures uuid[];
  matchup jsonb;
  playoff_fixture_id uuid;
begin
  select * into strict tournament_row
  from public.tournament where singleton for update;
  if tournament_row.version <> p_expected_version then
    raise exception 'Tournament version conflict' using errcode = '40001';
  end if;
  if exists (
    select 1 from public.matches as placement_match
    join public.team_fixtures as placement on placement.id = placement_match.fixture_id
    where placement.tournament_id = tournament_row.id
      and placement.stage in ('third-place', 'final')
      and placement_match.state <> 'unstarted'
  ) then
    raise exception 'Draws are locked after placement play starts'
      using errcode = '55000';
  end if;

  select * into round_row
  from public.qualification_playoff_rounds
  where id = tournament_row.current_playoff_round_id;
  if not found or cardinality(round_row.team_ids) <> 4
    or jsonb_typeof(p_payload -> 'matchups') is distinct from 'array'
    or jsonb_array_length(p_payload -> 'matchups') <> 2 then
    raise exception 'A four-team draw requires two complete matchups'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(id order by id), array[]::uuid[])
  into round_fixture_ids
  from public.team_fixtures where playoff_round_id = round_row.id;

  select array_agg(distinct (value ->> 'fixtureId')::uuid order by (value ->> 'fixtureId')::uuid)
  into supplied_fixtures
  from jsonb_array_elements(p_payload -> 'matchups');
  select array_agg(team_id order by team_id)
  into supplied_teams
  from jsonb_array_elements(p_payload -> 'matchups') as matchup_data
  cross join lateral unnest(array[
    (matchup_data.value ->> 'teamAId')::uuid,
    (matchup_data.value ->> 'teamBId')::uuid
  ]) as team_id;

  if supplied_fixtures is distinct from round_fixture_ids
    or cardinality(round_fixture_ids) <> 2
    or supplied_teams is distinct from round_row.team_ids
    or exists (
      select 1 from public.matches as playoff_match
      where playoff_match.fixture_id = any(round_fixture_ids)
        and playoff_match.state = 'playing'
    ) then
    raise exception 'Qualification-playoff matchups do not match the unresolved tie'
      using errcode = '55000';
  end if;

  delete from public.matches where fixture_id = any(round_fixture_ids);
  for matchup in select value from jsonb_array_elements(p_payload -> 'matchups')
  loop
    update public.team_fixtures
    set team_a_id = (matchup ->> 'teamAId')::uuid,
        team_b_id = (matchup ->> 'teamBId')::uuid,
        version = version + 1,
        updated_at = clock_timestamp()
    where id = (matchup ->> 'fixtureId')::uuid;
  end loop;
  perform private.clear_placement_participants(tournament_row.id);
  foreach playoff_fixture_id in array round_fixture_ids
  loop
    perform private.sync_fixture_matches(playoff_fixture_id);
  end loop;
  return private.receipt(p_request_id, private.bump_team_tournament());
end;
$$;

-- Finalist confirmation opens placement matches for pair assignment.
create or replace function private.team_confirm_finalists(
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
  placement_fixture_id uuid;
  next_version integer;
begin
  select * into strict tournament_row
  from public.tournament where singleton for update;
  if tournament_row.version <> p_expected_version then
    raise exception 'Tournament version conflict' using errcode = '40001';
  end if;
  perform private.populate_placement_fixtures();
  if exists (
    select 1 from public.team_fixtures
    where tournament_id = tournament_row.id
      and stage in ('third-place', 'final')
      and (team_a_id is null or team_b_id is null)
  ) then
    raise exception 'Finalists are not resolved' using errcode = '55000';
  end if;
  for placement_fixture_id in
    select id from public.team_fixtures
    where tournament_id = tournament_row.id
      and stage in ('third-place', 'final')
  loop
    perform private.sync_fixture_matches(placement_fixture_id);
  end loop;
  update public.tournament
  set finalists_confirmed_at = clock_timestamp(),
      stage = 'knockouts',
      version = version + 1,
      result_revision = result_revision + 1,
      updated_at = clock_timestamp()
  where id = tournament_row.id
  returning version into next_version;
  return private.receipt(p_request_id, next_version);
end;
$$;

create or replace function private.team_start_qualifying(
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
  fixture_id uuid;
  next_version integer;
begin
  select * into strict tournament_row from public.tournament where singleton for update;
  if tournament_row.version <> p_expected_version then
    raise exception 'Tournament version conflict' using errcode = '40001';
  end if;
  if tournament_row.stage <> 'setup'
    or (select count(*) from public.teams where tournament_id = tournament_row.id) <> 4
    or (select count(*) from public.players as player
        join public.teams as team on team.id = player.team_id
        where team.tournament_id = tournament_row.id) <> 16
    or (select count(*) from public.team_fixtures
        where tournament_id = tournament_row.id and stage = 'qualifying') <> 6 then
    raise exception 'Qualifying requires four complete teams' using errcode = '55000';
  end if;
  for fixture_id in
    select id from public.team_fixtures
    where tournament_id = tournament_row.id and stage = 'qualifying'
  loop
    perform private.sync_fixture_matches(fixture_id);
  end loop;
  update public.tournament
  set stage = 'groups', setup_locked_at = clock_timestamp(),
      version = version + 1, result_revision = result_revision + 1,
      updated_at = clock_timestamp()
  where id = tournament_row.id returning version into next_version;
  return private.receipt(p_request_id, next_version);
end;
$$;

-- Scoring paths ------------------------------------------------------------

create or replace function private.team_start_match(
  p_session_id uuid,
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
  target_match public.matches%rowtype;
  fixture public.team_fixtures%rowtype;
  tournament_row public.tournament%rowtype;
  tally record;
  next_match_version integer;
  next_tournament_version integer;
begin
  select * into strict target_match from public.matches
  where id = (p_payload ->> 'matchId')::uuid for update;
  select * into strict fixture from public.team_fixtures where id = target_match.fixture_id;
  select * into strict tournament_row from public.tournament where id = fixture.tournament_id;
  if target_match.version <> p_expected_version then
    raise exception 'Match version conflict' using errcode = '40001';
  end if;
  if tournament_row.stage = 'setup'
    or target_match.state <> 'unstarted' or target_match.court is null
    or fixture.team_a_id is null or fixture.team_b_id is null
    or target_match.pair_a_player_1_id is null
    or target_match.pair_b_player_1_id is null then
    raise exception 'Match is not ready to start' using errcode = '55000';
  end if;
  if fixture.stage in ('third-place', 'final')
    and tournament_row.finalists_confirmed_at is null then
    raise exception 'Finalists must be confirmed before placement play'
      using errcode = '55000';
  end if;
  if fixture.stage = 'final' and not exists (
    select 1 from public.team_fixtures as third_place
    where third_place.tournament_id = fixture.tournament_id
      and third_place.stage = 'third-place'
      and private.fixture_winner_team_id(third_place.id) is not null
  ) then
    raise exception 'Third place must finish before the final starts'
      using errcode = '55000';
  end if;
  if exists (
    select 1 from public.matches
    where id <> target_match.id and state = 'playing' and court = target_match.court
  ) then
    raise exception 'Court is occupied' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.matches as playing
    where playing.id <> target_match.id and playing.state = 'playing'
      and array[
        playing.pair_a_player_1_id, playing.pair_a_player_2_id,
        playing.pair_b_player_1_id, playing.pair_b_player_2_id
      ] && array[
        target_match.pair_a_player_1_id, target_match.pair_a_player_2_id,
        target_match.pair_b_player_1_id, target_match.pair_b_player_2_id
      ]
  ) then
    raise exception 'A player is already playing' using errcode = '55000';
  end if;
  if fixture.stage in ('third-place', 'final') and target_match.match_number = 3 then
    select * into tally from private.fixture_tally(fixture.id);
    if tally.wins_a <> 1 or tally.wins_b <> 1
      or (select count(*) from public.matches
          where fixture_id = fixture.id and match_number in (1, 2)
            and state = 'completed') <> 2 then
      raise exception 'Decider is not eligible' using errcode = '55000';
    end if;
  end if;
  insert into private.match_ownership (match_id, session_id)
  values (target_match.id, p_session_id)
  on conflict (match_id) do update
  set session_id = excluded.session_id, claimed_at = clock_timestamp();
  insert into public.match_games (match_id, game_number)
  values (target_match.id, 1)
  on conflict (match_id, game_number) do nothing;
  update public.matches
  set state = 'playing', version = version + 1, updated_at = clock_timestamp()
  where id = target_match.id returning version into next_match_version;
  next_tournament_version := private.bump_team_tournament();
  return private.receipt(
    p_request_id, next_tournament_version, target_match.id, next_match_version
  );
end;
$$;

create or replace function private.team_confirm_game(
  p_session_id uuid,
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
  target_match public.matches%rowtype;
  fixture_stage text;
  game public.match_games%rowtype;
  wins_a integer;
  wins_b integer;
  games_to_win integer;
  next_match_version integer;
  next_tournament_version integer;
begin
  select * into strict target_match from public.matches
  where id = (p_payload ->> 'matchId')::uuid for update;
  if target_match.version <> p_expected_version then
    raise exception 'Match version conflict' using errcode = '40001';
  end if;
  if target_match.state <> 'playing' then
    raise exception 'Game cannot be confirmed' using errcode = '55000';
  end if;
  perform private.require_match_owner(target_match.id, p_session_id);
  select fixture.stage into strict fixture_stage
  from public.team_fixtures as fixture where fixture.id = target_match.fixture_id;
  select * into strict game from public.match_games
  where match_id = target_match.id and confirmed_at is null
  order by game_number desc limit 1 for update;
  if not private.is_game_won(game.score_a, game.score_b, fixture_stage) then
    raise exception 'Game does not have a valid winning score' using errcode = '22023';
  end if;
  update public.match_games
  set confirmed_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = game.id;
  select count(*) filter (where score_a > score_b),
         count(*) filter (where score_b > score_a)
  into wins_a, wins_b
  from public.match_games
  where match_id = target_match.id and confirmed_at is not null;
  games_to_win := private.games_to_win(fixture_stage);
  if greatest(wins_a, wins_b) = games_to_win then
    update public.matches
    set state = 'completed', result_kind = 'played',
        winner_side = case when wins_a = games_to_win then 'a' else 'b' end,
        version = version + 1, updated_at = clock_timestamp()
    where id = target_match.id returning version into next_match_version;
    delete from private.match_ownership where match_id = target_match.id;
    perform private.finish_fixture_if_decided(target_match.fixture_id);
  else
    insert into public.match_games (match_id, game_number)
    values (target_match.id, game.game_number + 1);
    update public.matches
    set version = version + 1, updated_at = clock_timestamp()
    where id = target_match.id returning version into next_match_version;
  end if;
  next_tournament_version := private.bump_team_tournament();
  return private.receipt(
    p_request_id, next_tournament_version, target_match.id, next_match_version
  );
end;
$$;

-- Courts stay on a match once it finishes, so progress reset can return the
-- schedule intact; occupancy only ever counts playing matches.
create or replace function private.finish_fixture_if_decided(p_fixture_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  fixture public.team_fixtures%rowtype;
  tally record;
  needed_wins integer;
begin
  select * into strict fixture from public.team_fixtures where id = p_fixture_id;
  select * into tally from private.fixture_tally(p_fixture_id);
  needed_wins := case when fixture.stage in ('qualifying', 'qualification-playoff') then 1 else 2 end;

  if fixture.stage = 'qualifying' then
    if (select count(*) from public.matches
        where fixture_id = fixture.id and state = 'completed') = 2 then
      perform private.populate_placement_fixtures();
    end if;
    return;
  end if;

  if greatest(tally.wins_a, tally.wins_b) < needed_wins then return; end if;

  if fixture.stage in ('third-place', 'final') then
    update public.matches
    set state = 'unnecessary', version = version + 1,
        updated_at = clock_timestamp()
    where fixture_id = p_fixture_id and match_number = 3 and state = 'unstarted';
  end if;

  if fixture.stage = 'qualification-playoff' then
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

-- A walkover needs both teams: a released playoff slot has none and must not
-- carry a result into the round that reuses it.
create or replace function private.team_mark_walkover(
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
  target_match public.matches%rowtype;
  fixture public.team_fixtures%rowtype;
  side text := p_payload ->> 'winnerSide';
  tally record;
  next_match_version integer;
  next_tournament_version integer;
begin
  select * into strict target_match from public.matches
  where id = (p_payload ->> 'matchId')::uuid for update;
  select * into strict fixture from public.team_fixtures where id = target_match.fixture_id;
  if target_match.version <> p_expected_version then
    raise exception 'Match version conflict' using errcode = '40001';
  end if;
  if fixture.team_a_id is null or fixture.team_b_id is null then
    raise exception 'Fixture participants are not assigned' using errcode = '55000';
  end if;
  if target_match.state not in ('unstarted', 'playing') or side not in ('a', 'b')
    or exists (
      select 1 from public.match_games
      where match_id = target_match.id
        and (score_a <> 0 or score_b <> 0 or confirmed_at is not null)
    ) then
    raise exception 'Walkover requires an unscored match and one winner' using errcode = '55000';
  end if;
  if target_match.match_number = 3 then
    select * into tally from private.fixture_tally(target_match.fixture_id);
    if tally.wins_a <> 1 or tally.wins_b <> 1
      or (select count(*) from public.matches
          where fixture_id = target_match.fixture_id and match_number in (1, 2)
            and state = 'completed') <> 2 then
      raise exception 'Decider is not eligible' using errcode = '55000';
    end if;
  end if;
  delete from public.match_games where match_id = target_match.id;
  delete from private.match_ownership where match_id = target_match.id;
  update public.matches
  set state = 'completed', result_kind = 'walkover', winner_side = side,
      version = version + 1, updated_at = clock_timestamp()
  where id = target_match.id returning version into next_match_version;
  perform private.finish_fixture_if_decided(target_match.fixture_id);
  next_tournament_version := private.bump_team_tournament();
  return private.receipt(
    p_request_id, next_tournament_version, target_match.id, next_match_version
  );
end;
$$;

create or replace function private.team_assign_courts(
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
  assignment jsonb;
  next_version integer;
begin
  select * into strict tournament_row from public.tournament where singleton for update;
  if tournament_row.version <> p_expected_version then
    raise exception 'Tournament version conflict' using errcode = '40001';
  end if;
  if jsonb_typeof(p_payload -> 'assignments') <> 'array' then
    raise exception 'Invalid court assignments' using errcode = '22023';
  end if;
  for assignment in select value from jsonb_array_elements(p_payload -> 'assignments')
  loop
    if (assignment ->> 'court')::integer not in (1, 2) then
      raise exception 'Court must be 1 or 2' using errcode = '22023';
    end if;
    update public.matches as match
    set court = (assignment ->> 'court')::smallint,
        version = match.version + 1,
        updated_at = clock_timestamp()
    from public.team_fixtures as fixture
    where match.id = (assignment ->> 'matchId')::uuid
      and match.state = 'unstarted'
      and fixture.id = match.fixture_id
      and fixture.team_a_id is not null
      and fixture.team_b_id is not null;
    if not found then
      raise exception 'Only unstarted matches can be assigned' using errcode = '55000';
    end if;
  end loop;
  next_version := private.bump_team_tournament();
  return private.receipt(p_request_id, next_version);
end;
$$;

-- Corrections ---------------------------------------------------------------

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
  game_data jsonb;
  game_number integer := 0;
  score_a integer;
  score_b integer;
  wins_a integer := 0;
  wins_b integer := 0;
  games_to_win integer;
  next_match_version integer;
begin
  select * into strict target_match from public.matches where id = p_match_id for update;
  select fixture.stage into strict fixture_stage
  from public.team_fixtures as fixture where fixture.id = target_match.fixture_id;
  games_to_win := private.games_to_win(fixture_stage);
  if p_winner_side not in ('a', 'b') or jsonb_typeof(p_games) <> 'array'
    or (games_to_win = 1 and jsonb_array_length(p_games) <> 1)
    or (games_to_win = 2 and jsonb_array_length(p_games) not between 2 and 3) then
    raise exception 'Corrected result has the wrong number of games'
      using errcode = '22023';
  end if;
  delete from public.match_games where match_id = target_match.id;
  for game_data in select value from jsonb_array_elements(p_games)
  loop
    game_number := game_number + 1;
    score_a := (game_data ->> 'a')::integer;
    score_b := (game_data ->> 'b')::integer;
    if not private.is_game_won(score_a, score_b, fixture_stage)
      or greatest(wins_a, wins_b) = games_to_win then
      raise exception 'Corrected games contain an invalid score or an extra game'
        using errcode = '22023';
    end if;
    wins_a := wins_a + case when score_a > score_b then 1 else 0 end;
    wins_b := wins_b + case when score_b > score_a then 1 else 0 end;
    insert into public.match_games (
      match_id, game_number, score_a, score_b, confirmed_at
    ) values (
      target_match.id, game_number, score_a, score_b, clock_timestamp()
    );
  end loop;
  if (p_winner_side = 'a' and wins_a <> games_to_win)
    or (p_winner_side = 'b' and wins_b <> games_to_win)
    or greatest(wins_a, wins_b) <> games_to_win then
    raise exception 'Corrected winner does not match the games' using errcode = '22023';
  end if;
  delete from private.match_ownership where match_id = target_match.id;
  update public.matches
  set state = 'completed', result_kind = 'played', winner_side = p_winner_side,
      version = version + 1, updated_at = clock_timestamp()
  where id = target_match.id returning version into next_match_version;
  perform private.finish_fixture_if_decided(target_match.fixture_id);
  perform private.populate_placement_fixtures();
  return next_match_version;
end;
$$;

-- A correction is blocked when it would change a playoff round that already
-- has a started match, or the placement participants after placement play
-- starts. The projection runs inside a rolled-back subtransaction.
create or replace function private.team_correction_block_code(
  p_match_id uuid,
  p_new_winner_side text,
  p_games jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_match public.matches%rowtype;
  fixture public.team_fixtures%rowtype;
  started_round_ids uuid[];
  placement_started boolean;
  before_rounds jsonb;
  after_rounds jsonb;
  before_placement jsonb;
  after_placement jsonb;
begin
  if (select stage from public.tournament where singleton) = 'completed' then
    return 'tournament-completed';
  end if;
  select * into target_match from public.matches where id = p_match_id;
  if not found or target_match.state <> 'completed'
    or p_new_winner_side not in ('a', 'b') then
    return 'invalid-match-state';
  end if;
  select * into strict fixture
  from public.team_fixtures where id = target_match.fixture_id;

  select coalesce(array_agg(distinct round.id), array[]::uuid[])
  into started_round_ids
  from public.qualification_playoff_rounds as round
  join public.team_fixtures as playoff on playoff.playoff_round_id = round.id
  join public.matches as playoff_match on playoff_match.fixture_id = playoff.id
  where round.tournament_id = fixture.tournament_id
    and playoff_match.state <> 'unstarted';
  select exists (
    select 1 from public.matches as placement_match
    join public.team_fixtures as placement
      on placement.id = placement_match.fixture_id
    where placement.tournament_id = fixture.tournament_id
      and placement.stage in ('third-place', 'final')
      and placement_match.state <> 'unstarted'
  ) into placement_started;

  if not placement_started and cardinality(started_round_ids) = 0 then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_array(
    round.id, round.round_number, round.team_ids,
    round.fixed_finalist_ids, round.available_places
  ) order by round.round_number), '[]'::jsonb)
  into before_rounds
  from public.qualification_playoff_rounds as round
  where round.id = any(started_round_ids);
  select coalesce(jsonb_agg(jsonb_build_array(
    placement.stage, placement.team_a_id, placement.team_b_id
  ) order by placement.stage), '[]'::jsonb)
  into before_placement
  from public.team_fixtures as placement
  where placement.tournament_id = fixture.tournament_id
    and placement.stage in ('third-place', 'final');

  begin
    -- Placement play is set aside so the projection can reassign placement
    -- participants; populate_placement_fixtures skips that once play starts.
    delete from public.match_games as game
    using public.matches as placement_match,
          public.team_fixtures as placement
    where game.match_id = placement_match.id
      and placement_match.fixture_id = placement.id
      and placement.tournament_id = fixture.tournament_id
      and placement.stage in ('third-place', 'final');
    delete from private.match_ownership as ownership
    using public.matches as placement_match,
          public.team_fixtures as placement
    where ownership.match_id = placement_match.id
      and placement_match.fixture_id = placement.id
      and placement.tournament_id = fixture.tournament_id
      and placement.stage in ('third-place', 'final');
    update public.matches as placement_match
    set state = 'unstarted', result_kind = null, winner_side = null,
        version = version + 1, updated_at = clock_timestamp()
    from public.team_fixtures as placement
    where placement_match.fixture_id = placement.id
      and placement.tournament_id = fixture.tournament_id
      and placement.stage in ('third-place', 'final');
    perform private.apply_team_correction(
      p_match_id, p_new_winner_side, p_games
    );
    select coalesce(jsonb_agg(jsonb_build_array(
      round.id, round.round_number, round.team_ids,
      round.fixed_finalist_ids, round.available_places
    ) order by round.round_number), '[]'::jsonb)
    into after_rounds
    from public.qualification_playoff_rounds as round
    where round.id = any(started_round_ids);
    select coalesce(jsonb_agg(jsonb_build_array(
      placement.stage, placement.team_a_id, placement.team_b_id
    ) order by placement.stage), '[]'::jsonb)
    into after_placement
    from public.team_fixtures as placement
    where placement.tournament_id = fixture.tournament_id
      and placement.stage in ('third-place', 'final');
    raise exception 'rollback-correction-boundary-projection' using errcode = 'P0001';
  exception when raise_exception then
    if sqlerrm <> 'rollback-correction-boundary-projection' then raise; end if;
  end;

  if before_rounds is distinct from after_rounds then
    return 'playoff-started';
  end if;
  if placement_started
    and before_placement is distinct from after_placement then
    return 'placement-started';
  end if;
  return null;
end;
$$;

-- preview_result_correction keeps its handshake; its after-body now carries
-- rebuilt rounds and cleared placement pairs through snapshot_body.

-- Setup and reset -----------------------------------------------------------

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
  next_version integer;
begin
  if jsonb_typeof(p_payload -> 'teams') <> 'array'
    or length(btrim(p_payload ->> 'tournamentName')) = 0 then
    raise exception 'Invalid roster payload' using errcode = '22023';
  end if;

  team_count := jsonb_array_length(p_payload -> 'teams');
  select coalesce(sum(jsonb_array_length(value -> 'players')), 0)
  into player_count
  from jsonb_array_elements(p_payload -> 'teams');
  if team_count <> 4 or player_count <> 16 then
    raise exception 'Roster requires four teams and sixteen players'
      using errcode = '22023';
  end if;

  select * into tournament_row from public.tournament where singleton for update;
  if not found then
    if p_expected_version is distinct from 0 then
      raise exception 'Tournament version conflict' using errcode = '40001';
    end if;
    insert into public.tournament (name)
    values (btrim(p_payload ->> 'tournamentName'))
    returning * into tournament_row;
  elsif tournament_row.version <> p_expected_version then
    raise exception 'Tournament version conflict' using errcode = '40001';
  elsif tournament_row.stage <> 'setup'
    or exists (select 1 from public.matches where state <> 'unstarted') then
    raise exception 'Roster is locked after qualifying starts' using errcode = '55000';
  end if;

  update public.tournament
  set current_playoff_round_id = null
  where id = tournament_row.id;
  delete from public.qualification_playoff_rounds
  where tournament_id = tournament_row.id;
  delete from public.team_fixtures where tournament_id = tournament_row.id;
  delete from public.players where team_id in (
    select id from public.teams where tournament_id = tournament_row.id
  );
  delete from public.teams where tournament_id = tournament_row.id;

  for team_data in select value from jsonb_array_elements(p_payload -> 'teams')
  loop
    if length(btrim(team_data ->> 'name')) = 0
      or jsonb_typeof(team_data -> 'players') <> 'array'
      or jsonb_array_length(team_data -> 'players') <> 4
      or (select count(*) from jsonb_array_elements(team_data -> 'players')
          where (value ->> 'seed')::integer = 1) <> 2
      or (select count(*) from jsonb_array_elements(team_data -> 'players')
          where (value ->> 'seed')::integer = 2) <> 2 then
      raise exception 'Each team requires two seed 1 and two seed 2 players'
        using errcode = '22023';
    end if;
    insert into public.teams (tournament_id, name)
    values (tournament_row.id, btrim(team_data ->> 'name'))
    returning id into team_id;
    for player_data in select value from jsonb_array_elements(team_data -> 'players')
    loop
      if length(btrim(player_data ->> 'name')) = 0
        or (player_data ->> 'seed')::integer not in (1, 2) then
        raise exception 'Invalid player' using errcode = '22023';
      end if;
      insert into public.players (team_id, name, seed)
      values (
        team_id, btrim(player_data ->> 'name'),
        (player_data ->> 'seed')::smallint
      );
    end loop;
  end loop;

  insert into public.team_fixtures (tournament_id, stage, team_a_id, team_b_id)
  select tournament_row.id, 'qualifying', first_team.id, second_team.id
  from public.teams as first_team
  join public.teams as second_team
    on second_team.tournament_id = first_team.tournament_id
    and first_team.id < second_team.id
  where first_team.tournament_id = tournament_row.id;
  insert into public.team_fixtures (tournament_id, stage)
  values
    (tournament_row.id, 'third-place'),
    (tournament_row.id, 'final');

  update public.tournament
  set name = btrim(p_payload ->> 'tournamentName'),
      stage = 'setup', setup_locked_at = null,
      finalists_confirmed_at = null,
      version = version + 1, result_revision = result_revision + 1,
      updated_at = clock_timestamp()
  where id = tournament_row.id returning version into next_version;
  return private.receipt(p_request_id, next_version);
end;
$$;

-- Progress reset keeps every fixture, match identity, and court. Playoff
-- rounds are released so fresh qualifying results decide them again, reusing
-- the retained slots.
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
    if logged.operation <> 'reset_tournament'
      or logged.payload_fingerprint <> fingerprint then
      raise exception 'Request ID was already used with different input'
        using errcode = '22023';
    end if;
    return logged.response;
  end if;
  select * into strict state_row from private.maintenance_state
  where singleton for update;
  select * into tournament_row from public.tournament where singleton for update;
  if not found or p_request_id is null or p_mode not in ('progress', 'all')
    or state_row.reset_generation <> p_expected_generation
    or not state_row.reset_enabled
    or tournament_row.id is distinct from p_expected_tournament_id
    or tournament_row.version is distinct from p_expected_version
    or btrim(tournament_row.name) is distinct from btrim(p_confirmation_name) then
    raise exception 'Reset target, generation, mode, or enable state is invalid'
      using errcode = '55000';
  end if;
  next_generation := state_row.reset_generation + 1;
  delete from private.scoring_handovers where id is not null;
  delete from private.match_ownership where match_id is not null;
  if p_mode = 'progress' then
    perform private.release_playoff_rounds(tournament_row.id, 1);
    delete from public.match_games as game
    using public.matches as match, public.team_fixtures as fixture
    where game.match_id = match.id
      and match.fixture_id = fixture.id
      and fixture.tournament_id = tournament_row.id;
    update public.matches as match
    set state = 'unstarted', result_kind = null, winner_side = null,
        pair_a_player_1_id = null, pair_a_player_2_id = null,
        pair_b_player_1_id = null, pair_b_player_2_id = null,
        version = match.version + 1, updated_at = clock_timestamp()
    from public.team_fixtures as fixture
    where match.fixture_id = fixture.id
      and fixture.tournament_id = tournament_row.id;
    update public.team_fixtures
    set team_a_id = null, team_b_id = null, version = version + 1,
        updated_at = clock_timestamp()
    where tournament_id = tournament_row.id
      and stage in ('third-place', 'final', 'qualification-playoff')
      and (team_a_id is not null or team_b_id is not null);
    update public.tournament
    set stage = 'setup', setup_locked_at = null,
        finalists_confirmed_at = null,
        current_playoff_round_id = null,
        version = version + 1, result_revision = result_revision + 1,
        updated_at = clock_timestamp()
    where id = tournament_row.id returning version into next_version;
  else
    update public.tournament
    set current_playoff_round_id = null
    where id = tournament_row.id;
    delete from public.tournament where id = tournament_row.id;
    next_version := 0;
  end if;
  update private.maintenance_state
  set reset_enabled = false, reset_generation = next_generation,
      updated_at = clock_timestamp()
  where singleton;
  update public.tournament_generation
  set reset_generation = next_generation where singleton;
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

-- Snapshot -----------------------------------------------------------------

-- Saved pairs publish as match columns the moment they are saved.
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
      select jsonb_agg(
        to_jsonb(team_row) - 'tournament_id' - 'created_at'
        order by team_row.name, team_row.id
      )
      from public.teams as team_row
      where team_row.tournament_id = tournament_row.id
    ), '[]'::jsonb),
    'players', coalesce((
      select jsonb_agg(
        to_jsonb(player_row) - 'created_at'
        order by player_row.team_id, player_row.seed, player_row.name, player_row.id
      )
      from public.players as player_row
      join public.teams as team_row on team_row.id = player_row.team_id
      where team_row.tournament_id = tournament_row.id
    ), '[]'::jsonb),
    'fixtures', coalesce((
      select jsonb_agg(
        to_jsonb(fixture_row) - 'tournament_id' - 'created_at' - 'updated_at'
        order by case fixture_row.stage
          when 'qualifying' then 1
          when 'qualification-playoff' then 2
          when 'third-place' then 3
          else 4
        end, round_row.round_number nulls last, fixture_row.created_at, fixture_row.id
      )
      from public.team_fixtures as fixture_row
      left join public.qualification_playoff_rounds as round_row
        on round_row.id = fixture_row.playoff_round_id
      where fixture_row.tournament_id = tournament_row.id
    ), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(
        to_jsonb(match_row) - 'created_at' - 'updated_at'
        order by case fixture_row.stage
          when 'qualifying' then 1
          when 'qualification-playoff' then 2
          when 'third-place' then 3
          else 4
        end, fixture_row.id, match_row.match_number
      )
      from public.matches as match_row
      join public.team_fixtures as fixture_row on fixture_row.id = match_row.fixture_id
      where fixture_row.tournament_id = tournament_row.id
    ), '[]'::jsonb),
    'games', coalesce((
      select jsonb_agg(
        to_jsonb(game_row) - 'created_at' - 'updated_at'
        order by game_row.match_id, game_row.game_number
      )
      from public.match_games as game_row
      join public.matches as match_row on match_row.id = game_row.match_id
      join public.team_fixtures as fixture_row on fixture_row.id = match_row.fixture_id
      where fixture_row.tournament_id = tournament_row.id
    ), '[]'::jsonb),
    'playoff_rounds', coalesce((
      select jsonb_agg(
        to_jsonb(round_row) - 'tournament_id' - 'created_at'
        order by round_row.round_number
      )
      from public.qualification_playoff_rounds as round_row
      where round_row.tournament_id = tournament_row.id
    ), '[]'::jsonb),
    'standings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'teamId', standing.team_id,
        'matchWins', standing.match_wins,
        'pointsScored', standing.points_scored,
        'pointsConceded', standing.points_conceded,
        'pointDifference', standing.point_difference,
        'rank', standing.rank
      ) order by standing.rank, standing.team_id)
      from private.qualifying_standings() as standing
    ), '[]'::jsonb)
  )
  from public.tournament as tournament_row
  where tournament_row.singleton;
$$;

-- Command routing -----------------------------------------------------------

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
    'assign_pair', 'start_match', 'take_over', 'add_point', 'undo_point', 'confirm_game'
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
    when 'start_match' then private.team_start_match(staff_session, p_request_id, p_expected_version, p_payload)
    when 'take_over' then private.team_take_over(staff_session, p_request_id, p_expected_version, p_payload)
    when 'add_point' then private.team_add_point(staff_session, p_request_id, p_expected_version, p_payload)
    when 'undo_point' then private.team_undo_point(staff_session, p_request_id, p_expected_version, p_payload)
    when 'confirm_game' then private.team_confirm_game(staff_session, p_request_id, p_expected_version, p_payload)
    when 'mark_walkover' then private.team_mark_walkover(p_request_id, p_expected_version, p_payload)
    when 'correct_result' then private.team_correct_result(p_request_id, p_expected_version, p_payload)
    when 'record_draw' then private.team_record_draw(p_request_id, p_expected_version, p_payload)
    when 'confirm_finalists' then private.team_confirm_finalists(p_request_id, p_expected_version, p_payload)
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

create function public.assign_pair(
  p_request_id uuid, p_reset_generation integer,
  p_expected_version integer, p_payload jsonb
) returns jsonb language sql security definer set search_path = '' as $$
  select private.invoke_team_mutation(
    'assign_pair', p_request_id, p_reset_generation, p_expected_version, p_payload
  );
$$;
revoke all on function public.assign_pair(uuid, integer, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.assign_pair(uuid, integer, integer, jsonb)
  to authenticated;

-- Obsolete lineup surface ---------------------------------------------------
-- Every caller above has been replaced, so these drop without CASCADE.

drop function public.save_lineup(uuid, integer, integer, jsonb);
drop function public.confirm_lineup(uuid, integer, integer, jsonb);
drop function public.reopen_lineups(uuid, integer, integer, jsonb);
drop function public.substitute_players(uuid, integer, integer, jsonb);
drop function private.team_save_lineup(uuid, integer, jsonb);
drop function private.team_confirm_lineup(uuid, integer, jsonb);
drop function private.team_reopen_lineups(uuid, integer, jsonb);
drop function private.team_substitute_players(uuid, integer, jsonb);
drop function private.qualification_requirement();
drop table private.lineups;
alter table public.tournament drop column qualification_draw_winner_ids;

revoke all on all functions in schema private
  from public, anon, authenticated, service_role;
