-- Replace the two-group format with a four-team round robin.
-- Existing tournament identity, teams, players, and seeds are preserved; all
-- format-specific progress is intentionally discarded.

delete from private.scoring_handovers where id is not null;
delete from private.match_ownership where match_id is not null;
delete from public.match_games where id is not null;
delete from public.matches where id is not null;
delete from private.lineups where fixture_id is not null;
delete from public.team_fixtures where id is not null;

drop index if exists public.team_fixtures_group_unique;
drop index if exists public.team_fixtures_placement_unique;
alter table public.team_fixtures
  drop constraint if exists team_fixtures_tournament_id_stage_group_code_key,
  drop constraint if exists team_fixtures_stage_check,
  drop constraint if exists team_fixtures_check,
  drop column group_code;
alter table public.team_fixtures
  add constraint team_fixtures_stage_check
  check (stage in ('qualifying', 'qualification-playoff', 'third-place', 'final'));

alter table public.teams
  drop constraint if exists teams_group_code_check,
  drop column group_code;

alter table public.matches
  rename column pair_a_seed1_player_id to pair_a_player_1_id;
alter table public.matches
  rename column pair_a_seed2_player_id to pair_a_player_2_id;
alter table public.matches
  rename column pair_b_seed1_player_id to pair_b_player_1_id;
alter table public.matches
  rename column pair_b_seed2_player_id to pair_b_player_2_id;
alter table public.matches
  add constraint matches_pair_a_players_differ_check
    check (pair_a_player_1_id is null or pair_a_player_1_id <> pair_a_player_2_id),
  add constraint matches_pair_b_players_differ_check
    check (pair_b_player_1_id is null or pair_b_player_1_id <> pair_b_player_2_id);

alter table private.lineups
  drop constraint if exists lineups_match_number_check;
alter table private.lineups
  rename column seed1_player_id to player_1_id;
alter table private.lineups
  rename column seed2_player_id to player_2_id;
alter table private.lineups
  add constraint lineups_match_number_check check (match_number between 1 and 4);

alter table public.tournament
  add column finalists_confirmed_at timestamptz;

create index matches_playing_players_idx
  on public.matches (
    pair_a_player_1_id,
    pair_a_player_2_id,
    pair_b_player_1_id,
    pair_b_player_2_id
  )
  where state = 'playing';

create or replace function private.qualifying_standings()
returns table (
  team_id uuid,
  match_wins integer,
  points_scored integer,
  points_conceded integer,
  point_difference integer,
  rank integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with qualifying_matches as (
    select fixture.team_a_id,
           fixture.team_b_id,
           match.id as match_id,
           match.result_kind,
           match.winner_side,
           coalesce(sum(game.score_a), 0)::integer as points_a,
           coalesce(sum(game.score_b), 0)::integer as points_b
    from public.team_fixtures as fixture
    join public.matches as match on match.fixture_id = fixture.id
    left join public.match_games as game
      on game.match_id = match.id and game.confirmed_at is not null
    where fixture.stage = 'qualifying'
      and match.state = 'completed'
    group by fixture.team_a_id, fixture.team_b_id, match.id,
             match.result_kind, match.winner_side
  ), overall as (
    select team.id as team_id,
           count(*) filter (
             where (match.team_a_id = team.id and match.winner_side = 'a')
                or (match.team_b_id = team.id and match.winner_side = 'b')
           )::integer as match_wins,
           coalesce(sum(case
             when match.result_kind <> 'played' then 0
             when match.team_a_id = team.id then match.points_a
             else match.points_b
           end), 0)::integer as points_scored,
           coalesce(sum(case
             when match.result_kind <> 'played' then 0
             when match.team_a_id = team.id then match.points_b
             else match.points_a
           end), 0)::integer as points_conceded
    from public.teams as team
    left join qualifying_matches as match
      on team.id in (match.team_a_id, match.team_b_id)
    group by team.id
  ), tied_set as (
    select overall.*,
           array_agg(team_id) over (partition by match_wins) as tied_team_ids
    from overall
  ), head_to_head as (
    select tied.team_id,
           tied.match_wins,
           tied.points_scored,
           tied.points_conceded,
           count(*) filter (
             where match.team_a_id = any(tied.tied_team_ids)
               and match.team_b_id = any(tied.tied_team_ids)
               and ((match.team_a_id = tied.team_id and match.winner_side = 'a')
                 or (match.team_b_id = tied.team_id and match.winner_side = 'b'))
           )::integer as tied_match_wins,
           coalesce(sum(case
             when match.result_kind <> 'played'
               or match.team_a_id <> all(tied.tied_team_ids)
               or match.team_b_id <> all(tied.tied_team_ids) then 0
             when match.team_a_id = tied.team_id then match.points_a - match.points_b
             else match.points_b - match.points_a
           end), 0)::integer as tied_point_difference
    from tied_set as tied
    left join qualifying_matches as match
      on tied.team_id in (match.team_a_id, match.team_b_id)
    group by tied.team_id, tied.match_wins, tied.points_scored,
             tied.points_conceded, tied.tied_team_ids
  )
  select head.team_id,
         head.match_wins,
         head.points_scored,
         head.points_conceded,
         head.points_scored - head.points_conceded as point_difference,
         rank() over (order by
           head.match_wins desc,
           head.tied_match_wins desc,
           head.tied_point_difference desc,
           head.points_scored - head.points_conceded desc
         )::integer as rank
  from head_to_head as head;
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
  target integer := case when p_stage = 'qualification-playoff' then 11 else 21 end;
  cap integer := case when p_stage = 'qualification-playoff' then 15 else 30 end;
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

create or replace function private.fixture_winner_team_id(p_fixture_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when fixture.stage = 'qualification-playoff' and tally.wins_a >= 1 then fixture.team_a_id
    when fixture.stage = 'qualification-playoff' and tally.wins_b >= 1 then fixture.team_b_id
    when fixture.stage in ('third-place', 'final') and tally.wins_a >= 2 then fixture.team_a_id
    when fixture.stage in ('third-place', 'final') and tally.wins_b >= 2 then fixture.team_b_id
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
  required_matches integer;
  lineup_match_number integer;
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

  if lineup_count <> 8 then
    raise exception 'Both four-pair lineups must be confirmed' using errcode = '55000';
  end if;

  required_matches := case
    when fixture.stage = 'qualifying' then 2
    when fixture.stage = 'qualification-playoff' then 1
    else 3
  end;

  insert into public.matches (fixture_id, match_number)
  select fixture.id, match_number
  from generate_series(1, required_matches) as match_number
  on conflict (fixture_id, match_number) do nothing;

  update public.matches as match
  set pair_a_player_1_id = lineup_a.player_1_id,
      pair_a_player_2_id = lineup_a.player_2_id,
      pair_b_player_1_id = lineup_b.player_1_id,
      pair_b_player_2_id = lineup_b.player_2_id,
      version = match.version + 1,
      updated_at = clock_timestamp()
  from private.lineups as lineup_a,
       private.lineups as lineup_b
  where match.fixture_id = fixture.id
    and lineup_a.fixture_id = fixture.id
    and lineup_a.team_id = fixture.team_a_id
    and lineup_a.match_number = case when fixture.stage = 'qualification-playoff' then 4 else match.match_number end
    and lineup_b.fixture_id = fixture.id
    and lineup_b.team_id = fixture.team_b_id
    and lineup_b.match_number = case when fixture.stage = 'qualification-playoff' then 4 else match.match_number end
    and match.state = 'unstarted';
end;
$$;

insert into public.team_fixtures (tournament_id, stage, team_a_id, team_b_id)
select tournament.id, 'qualifying', first_team.id, second_team.id
from public.tournament as tournament
join public.teams as first_team on first_team.tournament_id = tournament.id
join public.teams as second_team
  on second_team.tournament_id = tournament.id and first_team.id < second_team.id
where tournament.singleton;

insert into public.team_fixtures (tournament_id, stage)
select tournament.id, stage
from public.tournament as tournament
cross join (values ('third-place'), ('final')) as placement(stage)
where tournament.singleton;

update public.tournament
set stage = 'setup',
    setup_locked_at = null,
    finalists_confirmed_at = null,
    version = version + 1,
    result_revision = result_revision + 1,
    updated_at = clock_timestamp()
where singleton;

revoke all on function private.qualifying_standings()
  from public, anon, authenticated, service_role;
