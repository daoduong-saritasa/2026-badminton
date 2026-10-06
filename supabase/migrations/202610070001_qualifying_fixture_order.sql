alter table public.team_fixtures
  add column qualifying_order smallint,
  add constraint team_fixtures_qualifying_order_check check (
    qualifying_order is null
    or (stage = 'qualifying' and qualifying_order between 1 and 6)
  );

create unique index team_fixtures_qualifying_order_unique
  on public.team_fixtures (tournament_id, qualifying_order)
  where qualifying_order is not null;

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
  new_team_id uuid;
  roster_team_ids uuid[] := array[]::uuid[];
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
  delete from public.players as player where player.team_id in (
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
    returning id into new_team_id;
    roster_team_ids := array_append(roster_team_ids, new_team_id);
    for player_data in select value from jsonb_array_elements(team_data -> 'players')
    loop
      if length(btrim(player_data ->> 'name')) = 0
        or (player_data ->> 'seed')::integer not in (1, 2) then
        raise exception 'Invalid player' using errcode = '22023';
      end if;
      insert into public.players (team_id, name, seed)
      values (
        new_team_id, btrim(player_data ->> 'name'),
        (player_data ->> 'seed')::smallint
      );
    end loop;
  end loop;

  insert into public.team_fixtures (
    tournament_id, stage, team_a_id, team_b_id, qualifying_order
  )
  select tournament_row.id, 'qualifying',
    roster_team_ids[schedule.team_a], roster_team_ids[schedule.team_b],
    schedule.position
  from (values
    (1, 1, 2),
    (2, 1, 3),
    (3, 2, 4),
    (4, 1, 4),
    (5, 2, 3),
    (6, 3, 4)
  ) as schedule(position, team_a, team_b);
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
        end, fixture_row.qualifying_order nulls last,
          round_row.round_number nulls last, fixture_row.created_at, fixture_row.id
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
        end, fixture_row.qualifying_order nulls last, fixture_row.id, match_row.match_number
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
