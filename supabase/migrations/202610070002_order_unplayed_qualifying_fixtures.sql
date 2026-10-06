select private.lock_mutations();

with eligible_tournaments as (
  select tournament.id
  from public.tournament as tournament
  where tournament.stage in ('setup', 'groups')
    and (select count(*) from public.teams
         where tournament_id = tournament.id) = 4
    and (select count(*) from public.team_fixtures
         where tournament_id = tournament.id and stage = 'qualifying') = 6
    and not exists (
      select 1 from public.team_fixtures
      where tournament_id = tournament.id and stage = 'qualifying'
        and qualifying_order is not null
    )
    and not exists (
      select 1 from public.matches as match
      join public.team_fixtures as fixture on fixture.id = match.fixture_id
      where fixture.tournament_id = tournament.id and fixture.stage = 'qualifying'
        and (match.state <> 'unstarted' or exists (
          select 1 from public.match_games where match_id = match.id
        ))
    )
), numbered_teams as (
  select team.id, team.tournament_id,
    row_number() over (
      partition by team.tournament_id order by team.name, team.id
    ) as position
  from public.teams as team
  join eligible_tournaments as tournament on tournament.id = team.tournament_id
), schedule(position, team_a, team_b) as (
  values (1, 1, 2), (2, 1, 3), (3, 2, 4), (4, 1, 4), (5, 2, 3), (6, 3, 4)
), ordered_fixtures as (
  select fixture.id, fixture.tournament_id, schedule.position
  from public.team_fixtures as fixture
  join numbered_teams as team_a
    on team_a.id = fixture.team_a_id and team_a.tournament_id = fixture.tournament_id
  join numbered_teams as team_b
    on team_b.id = fixture.team_b_id and team_b.tournament_id = fixture.tournament_id
  join schedule
    on schedule.team_a = least(team_a.position, team_b.position)
    and schedule.team_b = greatest(team_a.position, team_b.position)
  where fixture.stage = 'qualifying'
), complete_schedules as (
  select tournament_id from ordered_fixtures
  group by tournament_id
  having count(*) = 6 and count(distinct position) = 6
), updated_fixtures as (
  update public.team_fixtures as fixture
  set qualifying_order = ordered.position,
      version = fixture.version + 1,
      updated_at = clock_timestamp()
  from ordered_fixtures as ordered
  join complete_schedules as schedule on schedule.tournament_id = ordered.tournament_id
  where fixture.id = ordered.id
  returning fixture.tournament_id
)
update public.tournament as tournament
set version = tournament.version + 1, updated_at = clock_timestamp()
where tournament.id in (select tournament_id from updated_fixtures);
