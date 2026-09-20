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

  if fixture.stage = 'qualification-playoff' then
    select count(distinct lineup.team_id) into lineup_count
    from private.lineups as lineup
    join public.team_fixtures as qualifying on qualifying.id = lineup.fixture_id
    where qualifying.tournament_id = fixture.tournament_id
      and qualifying.stage = 'qualifying'
      and lineup.team_id in (fixture.team_a_id, fixture.team_b_id)
      and lineup.match_number = 4
      and lineup.confirmed_at is not null;
    if lineup_count <> 2 then
      raise exception 'Both predeclared playoff pairs must be confirmed' using errcode = '55000';
    end if;
  else
    select count(*) into lineup_count
    from private.lineups
    where fixture_id = fixture.id
      and team_id in (fixture.team_a_id, fixture.team_b_id)
      and confirmed_at is not null;
    if lineup_count <> 8 then
      raise exception 'Both four-pair lineups must be confirmed' using errcode = '55000';
    end if;
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

  if fixture.stage = 'qualification-playoff' then
    update public.matches as match
    set pair_a_player_1_id = (
          select lineup.player_1_id
          from private.lineups as lineup
          join public.team_fixtures as qualifying on qualifying.id = lineup.fixture_id
          where qualifying.tournament_id = fixture.tournament_id
            and qualifying.stage = 'qualifying'
            and lineup.team_id = fixture.team_a_id
            and lineup.match_number = 4
            and lineup.confirmed_at is not null
          order by qualifying.id limit 1
        ),
        pair_a_player_2_id = (
          select lineup.player_2_id
          from private.lineups as lineup
          join public.team_fixtures as qualifying on qualifying.id = lineup.fixture_id
          where qualifying.tournament_id = fixture.tournament_id
            and qualifying.stage = 'qualifying'
            and lineup.team_id = fixture.team_a_id
            and lineup.match_number = 4
            and lineup.confirmed_at is not null
          order by qualifying.id limit 1
        ),
        pair_b_player_1_id = (
          select lineup.player_1_id
          from private.lineups as lineup
          join public.team_fixtures as qualifying on qualifying.id = lineup.fixture_id
          where qualifying.tournament_id = fixture.tournament_id
            and qualifying.stage = 'qualifying'
            and lineup.team_id = fixture.team_b_id
            and lineup.match_number = 4
            and lineup.confirmed_at is not null
          order by qualifying.id limit 1
        ),
        pair_b_player_2_id = (
          select lineup.player_2_id
          from private.lineups as lineup
          join public.team_fixtures as qualifying on qualifying.id = lineup.fixture_id
          where qualifying.tournament_id = fixture.tournament_id
            and qualifying.stage = 'qualifying'
            and lineup.team_id = fixture.team_b_id
            and lineup.match_number = 4
            and lineup.confirmed_at is not null
          order by qualifying.id limit 1
        ),
        version = match.version + 1,
        updated_at = clock_timestamp()
    where match.fixture_id = fixture.id and match.state = 'unstarted';
  else
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
      and lineup_a.match_number = match.match_number
      and lineup_b.fixture_id = fixture.id
      and lineup_b.team_id = fixture.team_b_id
      and lineup_b.match_number = match.match_number
      and match.state = 'unstarted';
  end if;
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

-- Qualification progression ------------------------------------------------

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
  playoff_count integer;
  completed_playoff_count integer;
  placement_started boolean;
  participants_changed boolean;
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
    finalist_ids := fixed_finalists || tied_teams;
  else
    select count(*), count(*) filter (
      where fixture.team_a_id is not null
        and fixture.team_b_id is not null
        and private.fixture_winner_team_id(fixture.id) is not null
    )
    into playoff_count, completed_playoff_count
    from public.team_fixtures as fixture
    where fixture.tournament_id = target_tournament_id
      and fixture.stage = 'qualification-playoff';

    if playoff_count = 0 then
      if cardinality(tied_teams) = 2 then
        insert into public.team_fixtures (
          tournament_id, stage, team_a_id, team_b_id
        ) values (
          target_tournament_id, 'qualification-playoff', tied_teams[1], tied_teams[2]
        );
      elsif cardinality(tied_teams) = 3 then
        insert into public.team_fixtures (
          tournament_id, stage, team_a_id, team_b_id
        ) values
          (target_tournament_id, 'qualification-playoff', tied_teams[1], tied_teams[2]),
          (target_tournament_id, 'qualification-playoff', tied_teams[1], tied_teams[3]),
          (target_tournament_id, 'qualification-playoff', tied_teams[2], tied_teams[3]);
      elsif cardinality(tied_teams) = 4 then
        insert into public.team_fixtures (tournament_id, stage)
        values
          (target_tournament_id, 'qualification-playoff'),
          (target_tournament_id, 'qualification-playoff');
      end if;
      update public.team_fixtures
      set team_a_id = null, team_b_id = null, version = version + 1,
          updated_at = clock_timestamp()
      where tournament_id = target_tournament_id
        and stage in ('third-place', 'final');
      update public.tournament
      set finalists_confirmed_at = null, updated_at = clock_timestamp()
      where id = target_tournament_id;
      return;
    end if;

    if completed_playoff_count <> playoff_count then return; end if;

    if cardinality(tied_teams) in (2, 4) then
      select array_agg(winner_id order by winner_id)
      into finalist_ids
      from (
        select private.fixture_winner_team_id(fixture.id) as winner_id
        from public.team_fixtures as fixture
        where fixture.tournament_id = target_tournament_id
          and fixture.stage = 'qualification-playoff'
      ) as winners;
      finalist_ids := fixed_finalists || finalist_ids;
    else
      with playoff_matches as (
        select fixture.team_a_id,
               fixture.team_b_id,
               match.winner_side,
               coalesce(sum(game.score_a), 0)::integer as points_a,
               coalesce(sum(game.score_b), 0)::integer as points_b
        from public.team_fixtures as fixture
        join public.matches as match on match.fixture_id = fixture.id
        left join public.match_games as game
          on game.match_id = match.id and game.confirmed_at is not null
        where fixture.tournament_id = target_tournament_id
          and fixture.stage = 'qualification-playoff'
          and match.state = 'completed'
        group by fixture.team_a_id, fixture.team_b_id, match.id, match.winner_side
      ), playoff_standings as (
        select tied.team_id,
               count(*) filter (
                 where (match.team_a_id = tied.team_id and match.winner_side = 'a')
                    or (match.team_b_id = tied.team_id and match.winner_side = 'b')
               )::integer as wins,
               coalesce(sum(case when match.team_a_id = tied.team_id
                 then match.points_a - match.points_b
                 else match.points_b - match.points_a end), 0)::integer as point_difference,
               coalesce(sum(case when match.team_a_id = tied.team_id
                 then match.points_a else match.points_b end), 0)::integer as points_scored
        from unnest(tied_teams) as tied(team_id)
        join playoff_matches as match
          on tied.team_id in (match.team_a_id, match.team_b_id)
        group by tied.team_id
      ), ranked as (
        select *, rank() over (
          order by wins desc, point_difference desc, points_scored desc
        ) as playoff_rank
        from playoff_standings
      ), cutoff as (
        select playoff_rank
        from ranked
        order by playoff_rank, team_id
        offset available_places - 1 limit 1
      )
      select case
        when (select count(*) from ranked where playoff_rank = (select playoff_rank from cutoff))
          > available_places - (select count(*) from ranked where playoff_rank < (select playoff_rank from cutoff))
        then null
        else array_agg(team_id order by playoff_rank, team_id)
          filter (where playoff_rank <= (select playoff_rank from cutoff))
      end
      into finalist_ids
      from ranked;

      if finalist_ids is null then return; end if;
      finalist_ids := fixed_finalists || finalist_ids;
    end if;
  end if;

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

  delete from private.lineups as lineup
  using public.team_fixtures as placement
  where lineup.fixture_id = placement.id
    and placement.tournament_id = target_tournament_id
    and placement.stage in ('third-place', 'final')
    and (
      (placement.stage = 'final'
        and (placement.team_a_id <> all(finalist_ids) or placement.team_b_id <> all(finalist_ids)))
      or
      (placement.stage = 'third-place'
        and (placement.team_a_id <> all(nonfinalist_ids) or placement.team_b_id <> all(nonfinalist_ids)))
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
    set state = 'unnecessary', court = null, version = version + 1,
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

-- Organizer commands -------------------------------------------------------

create or replace function private.team_substitute_players(
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
  target_side text := p_payload ->> 'side';
  player_1 uuid := (p_payload ->> 'player1Id')::uuid;
  player_2 uuid := (p_payload ->> 'player2Id')::uuid;
  target_team uuid;
  next_match_version integer;
  next_tournament_version integer;
begin
  select * into strict target_match
  from public.matches
  where id = (p_payload ->> 'matchId')::uuid
  for update;
  select * into strict fixture from public.team_fixtures where id = target_match.fixture_id;

  if target_match.version <> p_expected_version then
    raise exception 'Match version conflict' using errcode = '40001';
  end if;
  if target_match.state <> 'unstarted' or target_side not in ('a', 'b') then
    raise exception 'Only an unstarted match can be substituted' using errcode = '55000';
  end if;
  if player_1 = player_2 then
    raise exception 'Substitution requires two distinct players' using errcode = '22023';
  end if;

  target_team := case when target_side = 'a' then fixture.team_a_id else fixture.team_b_id end;
  if target_team is null or (
    select count(*) from public.players
    where team_id = target_team and id in (player_1, player_2)
  ) <> 2 then
    raise exception 'Substitutes must belong to the fixture team' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.matches as playing
    where playing.state = 'playing'
      and (player_1 in (
        playing.pair_a_player_1_id, playing.pair_a_player_2_id,
        playing.pair_b_player_1_id, playing.pair_b_player_2_id
      ) or player_2 in (
        playing.pair_a_player_1_id, playing.pair_a_player_2_id,
        playing.pair_b_player_1_id, playing.pair_b_player_2_id
      ))
  ) then
    raise exception 'A substitute is already playing' using errcode = '55000';
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
  fixture public.team_fixtures%rowtype;
  team_a uuid := (p_payload ->> 'teamAId')::uuid;
  team_b uuid := (p_payload ->> 'teamBId')::uuid;
  next_version integer;
begin
  select * into strict fixture
  from public.team_fixtures
  where id = (p_payload ->> 'fixtureId')::uuid
  for update;
  if fixture.version <> p_expected_version then
    raise exception 'Fixture version conflict' using errcode = '40001';
  end if;
  if fixture.stage <> 'qualification-playoff' or team_a = team_b
    or (select count(*) from public.teams
        where tournament_id = fixture.tournament_id and id in (team_a, team_b)) <> 2
    or exists (
      select 1 from public.matches as placement_match
      join public.team_fixtures as placement on placement.id = placement_match.fixture_id
      where placement.tournament_id = fixture.tournament_id
        and placement.stage in ('third-place', 'final')
        and placement_match.state <> 'unstarted'
    ) then
    raise exception 'Qualification-playoff draw cannot be recorded' using errcode = '55000';
  end if;

  delete from public.matches where fixture_id = fixture.id;
  update public.team_fixtures
  set team_a_id = team_a,
      team_b_id = team_b,
      version = version + 1,
      updated_at = clock_timestamp()
  where id = fixture.id
  returning version into next_version;
  update public.team_fixtures
  set team_a_id = null, team_b_id = null, version = version + 1,
      updated_at = clock_timestamp()
  where tournament_id = fixture.tournament_id
    and stage in ('third-place', 'final');
  update public.tournament
  set finalists_confirmed_at = null, updated_at = clock_timestamp()
  where id = fixture.tournament_id;
  perform private.sync_fixture_matches(fixture.id);
  return private.receipt(
    p_request_id, private.bump_team_tournament(), null, null
  ) || jsonb_build_object('fixtureVersion', next_version);
end;
$$;

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
  replay := private.replay_mutation(
    staff_session, p_request_id, p_operation, p_expected_version, p_payload
  );
  if replay is not null then return replay; end if;

  response := case p_operation
    when 'save_roster' then private.team_save_roster(p_request_id, p_expected_version, p_payload)
    when 'save_lineup' then private.team_save_lineup(p_request_id, p_expected_version, p_payload)
    when 'confirm_lineup' then private.team_confirm_lineup(p_request_id, p_expected_version, p_payload)
    when 'reopen_lineups' then private.team_reopen_lineups(p_request_id, p_expected_version, p_payload)
    when 'start_qualifying' then private.team_start_qualifying(p_request_id, p_expected_version, p_payload)
    when 'assign_courts' then private.team_assign_courts(p_request_id, p_expected_version, p_payload)
    when 'start_match' then private.team_start_match(staff_session, p_request_id, p_expected_version, p_payload)
    when 'take_over' then private.team_take_over(staff_session, p_request_id, p_expected_version, p_payload)
    when 'add_point' then private.team_add_point(staff_session, p_request_id, p_expected_version, p_payload)
    when 'undo_point' then private.team_undo_point(staff_session, p_request_id, p_expected_version, p_payload)
    when 'confirm_game' then private.team_confirm_game(staff_session, p_request_id, p_expected_version, p_payload)
    when 'mark_walkover' then private.team_mark_walkover(p_request_id, p_expected_version, p_payload)
    when 'correct_result' then private.team_correct_result(p_request_id, p_expected_version, p_payload)
    when 'substitute_players' then private.team_substitute_players(p_request_id, p_expected_version, p_payload)
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

create function public.substitute_players(
  p_request_id uuid, p_reset_generation integer,
  p_expected_version integer, p_payload jsonb
) returns jsonb language sql security definer set search_path = '' as $$
  select private.invoke_team_mutation(
    'substitute_players', p_request_id, p_reset_generation, p_expected_version, p_payload
  );
$$;
create function public.record_draw(
  p_request_id uuid, p_reset_generation integer,
  p_expected_version integer, p_payload jsonb
) returns jsonb language sql security definer set search_path = '' as $$
  select private.invoke_team_mutation(
    'record_draw', p_request_id, p_reset_generation, p_expected_version, p_payload
  );
$$;
create function public.confirm_finalists(
  p_request_id uuid, p_reset_generation integer,
  p_expected_version integer, p_payload jsonb
) returns jsonb language sql security definer set search_path = '' as $$
  select private.invoke_team_mutation(
    'confirm_finalists', p_request_id, p_reset_generation, p_expected_version, p_payload
  );
$$;

revoke all on function public.substitute_players(uuid, integer, integer, jsonb)
  from public, anon, authenticated;
revoke all on function public.record_draw(uuid, integer, integer, jsonb)
  from public, anon, authenticated;
revoke all on function public.confirm_finalists(uuid, integer, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.substitute_players(uuid, integer, integer, jsonb)
  to authenticated;
grant execute on function public.record_draw(uuid, integer, integer, jsonb)
  to authenticated;
grant execute on function public.confirm_finalists(uuid, integer, integer, jsonb)
  to authenticated;

-- Snapshot -----------------------------------------------------------------

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
        end, fixture_row.id
      )
      from public.team_fixtures as fixture_row
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
                 'player1Id', lineup_row.player_1_id,
                 'player2Id', lineup_row.player_2_id
               ) order by lineup_row.match_number) as pairs,
               min(lineup_row.confirmed_at) as confirmed_at
        from private.lineups as lineup_row
        where private.staff_role() = 'organizer'
          or (
            select count(distinct confirmed.team_id)
            from private.lineups as confirmed
            join public.team_fixtures as confirmed_fixture
              on confirmed_fixture.id = confirmed.fixture_id
            where confirmed_fixture.tournament_id = tournament_row.id
              and confirmed_fixture.stage = 'qualifying'
              and confirmed.confirmed_at is not null
          ) = 4
          or (
            select count(distinct confirmed.team_id)
            from private.lineups as confirmed
            where confirmed.fixture_id = lineup_row.fixture_id
              and confirmed.confirmed_at is not null
          ) = 2
        group by lineup_row.fixture_id, lineup_row.team_id
      ) as lineup
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

revoke all on function private.snapshot_body()
  from public, anon, authenticated, service_role;

-- Setup and lineup commands ------------------------------------------------

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

create or replace function private.team_save_lineup(
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
  fixture public.team_fixtures%rowtype;
  target_team uuid := (p_payload ->> 'teamId')::uuid;
  pair_data jsonb;
  pair_number integer := 0;
  player_1 uuid;
  player_2 uuid;
  opening_ids uuid[] := array[]::uuid[];
begin
  select * into strict fixture from public.team_fixtures
  where id = (p_payload ->> 'fixtureId')::uuid for update;
  if fixture.version <> p_expected_version then
    raise exception 'Fixture version conflict' using errcode = '40001';
  end if;
  if target_team not in (fixture.team_a_id, fixture.team_b_id)
    or jsonb_typeof(p_payload -> 'pairs') <> 'array'
    or jsonb_array_length(p_payload -> 'pairs') <> 4
    or exists (select 1 from public.matches where fixture_id = fixture.id and state <> 'unstarted')
    or exists (select 1 from private.lineups where fixture_id = fixture.id and confirmed_at is not null) then
    raise exception 'Lineup cannot be changed' using errcode = '55000';
  end if;

  delete from private.lineups where fixture_id = fixture.id and team_id = target_team;
  for pair_data in select value from jsonb_array_elements(p_payload -> 'pairs')
  loop
    pair_number := pair_number + 1;
    player_1 := (pair_data ->> 'player1Id')::uuid;
    player_2 := (pair_data ->> 'player2Id')::uuid;
    if player_1 = player_2
      or (select count(*) from public.players
          where team_id = target_team and id in (player_1, player_2)) <> 2 then
      raise exception 'Lineup players must be distinct teammates' using errcode = '22023';
    end if;
    if pair_number <= 3 and (
      select count(distinct seed) from public.players where id in (player_1, player_2)
    ) <> 2 then
      raise exception 'Declared match pairs must mix seeds' using errcode = '22023';
    end if;
    if pair_number <= 2 then opening_ids := opening_ids || player_1 || player_2; end if;
    insert into private.lineups (
      fixture_id, team_id, match_number, player_1_id, player_2_id
    ) values (fixture.id, target_team, pair_number, player_1, player_2);
  end loop;
  if (select count(distinct player_id) from unnest(opening_ids) as player_id) <> 4 then
    raise exception 'Opening pairs must use all four players exactly once' using errcode = '22023';
  end if;
  update public.team_fixtures
  set version = version + 1, updated_at = clock_timestamp()
  where id = fixture.id;
  perform private.bump_team_tournament();
  return private.receipt(
    p_request_id, (select version from public.tournament where singleton)
  );
end;
$$;

create or replace function private.team_confirm_lineup(
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
  fixture public.team_fixtures%rowtype;
  target_team uuid := (p_payload ->> 'teamId')::uuid;
begin
  select * into strict fixture from public.team_fixtures
  where id = (p_payload ->> 'fixtureId')::uuid for update;
  if fixture.version <> p_expected_version then
    raise exception 'Fixture version conflict' using errcode = '40001';
  end if;
  if target_team not in (fixture.team_a_id, fixture.team_b_id)
    or (select count(*) from private.lineups
        where fixture_id = fixture.id and team_id = target_team) <> 4 then
    raise exception 'A complete four-pair lineup is required' using errcode = '55000';
  end if;
  update private.lineups
  set confirmed_at = clock_timestamp(), updated_at = clock_timestamp()
  where fixture_id = fixture.id and team_id = target_team and confirmed_at is null;
  update public.team_fixtures
  set version = version + 1, updated_at = clock_timestamp()
  where id = fixture.id;
  if (select count(*) from private.lineups
      where fixture_id = fixture.id and confirmed_at is not null) = 8
    and (select stage from public.tournament where singleton) <> 'setup' then
    perform private.sync_fixture_matches(fixture.id);
  end if;
  perform private.bump_team_tournament();
  return private.receipt(
    p_request_id, (select version from public.tournament where singleton)
  );
end;
$$;

alter function private.team_start_group_play(uuid, integer, jsonb)
  rename to team_start_qualifying;

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
    or (select count(*) from public.players) <> 16
    or (select count(*) from public.team_fixtures
        where tournament_id = tournament_row.id and stage = 'qualifying') <> 6
    or (select count(*) from private.lineups as lineup
        join public.team_fixtures as fixture on fixture.id = lineup.fixture_id
        where fixture.tournament_id = tournament_row.id
          and fixture.stage = 'qualifying'
          and lineup.confirmed_at is not null) <> 48 then
    raise exception 'All qualifying lineups and playoff pairs must be confirmed'
      using errcode = '55000';
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

create function public.start_qualifying(
  p_request_id uuid, p_reset_generation integer,
  p_expected_version integer, p_payload jsonb
) returns jsonb language sql security definer set search_path = '' as $$
  select private.invoke_team_mutation(
    'start_qualifying', p_request_id, p_reset_generation, p_expected_version, p_payload
  );
$$;
revoke all on function public.start_qualifying(uuid, integer, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.start_qualifying(uuid, integer, integer, jsonb)
  to authenticated;
create or replace function public.start_group_play(
  p_request_id uuid, p_reset_generation integer,
  p_expected_version integer, p_payload jsonb
) returns jsonb language sql security definer set search_path = '' as $$
  select private.invoke_team_mutation(
    'start_qualifying', p_request_id, p_reset_generation, p_expected_version, p_payload
  );
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
  if target_match.state <> 'unstarted' or target_match.court is null
    or target_match.pair_a_player_1_id is null then
    raise exception 'Match is not ready to start' using errcode = '55000';
  end if;
  if fixture.stage in ('third-place', 'final')
    and (select finalists_confirmed_at from public.tournament where singleton) is null then
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
  games_to_win := case when fixture_stage = 'final' then 2 else 1 end;
  if greatest(wins_a, wins_b) = games_to_win then
    update public.matches
    set state = 'completed', result_kind = 'played',
        winner_side = case when wins_a = games_to_win then 'a' else 'b' end,
        court = null, version = version + 1, updated_at = clock_timestamp()
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
  games_to_win := case when fixture_stage = 'final' then 2 else 1 end;
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
      court = null, version = version + 1, updated_at = clock_timestamp()
  where id = target_match.id returning version into next_match_version;
  perform private.finish_fixture_if_decided(target_match.fixture_id);
  perform private.populate_placement_fixtures();
  return next_match_version;
end;
$$;

-- Maintenance reset --------------------------------------------------------

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
    delete from public.team_fixtures where tournament_id = tournament_row.id;
    insert into public.team_fixtures (
      tournament_id, stage, team_a_id, team_b_id
    )
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
    set stage = 'setup', setup_locked_at = null,
        finalists_confirmed_at = null,
        version = version + 1, result_revision = result_revision + 1,
        updated_at = clock_timestamp()
    where id = tournament_row.id returning version into next_version;
  else
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
