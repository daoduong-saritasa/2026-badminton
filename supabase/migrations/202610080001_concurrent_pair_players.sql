-- Matches 1 and 2 of a fixture play at the same time, so a side cannot field
-- one player in both, in any stage. The decider is exempt.

-- Validates one side's pair on a locked, unstarted match and saves it.
-- Returns the match's new version.
create or replace function private.set_match_pair(
  p_match_id uuid,
  p_side text,
  p_player_1 uuid,
  p_player_2 uuid,
  p_rule_exception boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_match public.matches%rowtype;
  fixture public.team_fixtures%rowtype;
  tournament_row public.tournament%rowtype;
  target_team uuid;
  next_match_version integer;
begin
  if p_side is null or p_side not in ('a', 'b')
    or p_player_1 is null or p_player_2 is null then
    raise exception 'Invalid pair assignment' using errcode = '22023';
  end if;

  select * into strict target_match from public.matches where id = p_match_id;
  select * into strict fixture
  from public.team_fixtures where id = target_match.fixture_id;
  select * into strict tournament_row
  from public.tournament where id = fixture.tournament_id;

  if target_match.state <> 'unstarted' then
    raise exception 'Pairs are fixed after the match starts' using errcode = '55000';
  end if;
  target_team := case when p_side = 'a' then fixture.team_a_id else fixture.team_b_id end;
  if tournament_row.stage = 'setup' or target_team is null
    or (fixture.stage in ('third-place', 'final')
      and tournament_row.finalists_confirmed_at is null) then
    raise exception 'Pair assignment is not open for this match' using errcode = '55000';
  end if;

  if p_player_1 = p_player_2 then
    raise exception 'A pair requires two distinct players' using errcode = '22023';
  end if;
  if (select count(*) from public.players
      where team_id = target_team and id in (p_player_1, p_player_2)) <> 2 then
    raise exception 'Pair players must belong to the team' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.matches as playing
    where playing.state = 'playing'
      and array[
        playing.pair_a_player_1_id, playing.pair_a_player_2_id,
        playing.pair_b_player_1_id, playing.pair_b_player_2_id
      ] && array[p_player_1, p_player_2]
  ) then
    raise exception 'A player is already playing' using errcode = '55000';
  end if;

  if not p_rule_exception then
    if (fixture.stage = 'qualifying'
        or (fixture.stage = 'third-place' and target_match.match_number < 3))
      and (select count(distinct seed) from public.players
           where id in (p_player_1, p_player_2)) <> 2 then
      raise exception 'Pair must mix seeds' using errcode = '22023';
    end if;
    if target_match.match_number < 3 and exists (
      select 1 from public.matches as sibling
      where sibling.fixture_id = fixture.id
        and sibling.id <> target_match.id
        and sibling.match_number < 3
        and (case when p_side = 'a'
          then array[sibling.pair_a_player_1_id, sibling.pair_a_player_2_id]
          else array[sibling.pair_b_player_1_id, sibling.pair_b_player_2_id]
        end) && array[p_player_1, p_player_2]
    ) then
      raise exception 'Player already plays in this fixture' using errcode = '22023';
    end if;
  end if;

  update public.matches as match
  set pair_a_player_1_id = case when p_side = 'a' then p_player_1 else match.pair_a_player_1_id end,
      pair_a_player_2_id = case when p_side = 'a' then p_player_2 else match.pair_a_player_2_id end,
      pair_b_player_1_id = case when p_side = 'b' then p_player_1 else match.pair_b_player_1_id end,
      pair_b_player_2_id = case when p_side = 'b' then p_player_2 else match.pair_b_player_2_id end,
      version = match.version + 1,
      updated_at = clock_timestamp()
  where match.id = target_match.id
  returning match.version into next_match_version;
  return next_match_version;
end;
$$;
