-- The correction boundary projection reset placement matches with an
-- unqualified version, which also names team_fixtures.version in the same
-- update. Once placement play started, every correction preview and
-- correction failed with 42702.

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
        version = placement_match.version + 1, updated_at = clock_timestamp()
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
