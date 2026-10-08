select private.lock_mutations();

-- Matches 1 and 2 start on courts 1 and 2; a decider waits for staff to
-- choose its court.
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

  insert into public.matches (fixture_id, match_number, court)
  select fixture.id, match_number, case when match_number < 3 then match_number end
  from generate_series(1, case
    when fixture.stage = 'qualifying' then 2
    when fixture.stage = 'qualification-playoff' then 1
    else 3
  end) as match_number
  on conflict (fixture_id, match_number) do nothing;
end;
$$;

-- Matches created before courts were seeded take the same courts.
with seeded as (
  update public.matches as match
  set court = match.match_number, version = match.version + 1,
      updated_at = clock_timestamp()
  where match.state = 'unstarted' and match.court is null and match.match_number < 3
  returning match.fixture_id
)
update public.tournament as tournament
set version = tournament.version + 1, updated_at = clock_timestamp()
where tournament.id in (
  select fixture.tournament_id
  from public.team_fixtures as fixture
  where fixture.id in (select fixture_id from seeded)
);
