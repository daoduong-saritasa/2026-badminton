import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  elevate,
  mutation,
  requireLocalSupabase,
  resetLocalDatabase,
  rpc,
  runSql,
  signInAnonymously,
} from './local-supabase.ts'

interface Impact {
  after: { tournament: { finalists_confirmed_at: string | null } } | null
  before: unknown
  blockedReason: string | null
  tournamentVersion: number
}

type Side = 'a' | 'b'

interface SeededFixture {
  fixtureId: string
  matchOneId: string
  matchTwoId: string
}

/** One qualifying fixture whose two matches finished by walkover. */
function seedFixture(secondWinner: Side = 'b'): SeededFixture {
  const tournamentId = crypto.randomUUID()
  const [teamA, teamB] = [crypto.randomUUID(), crypto.randomUUID()]
  const fixtureId = crypto.randomUUID()
  const matchOneId = crypto.randomUUID()
  const matchTwoId = crypto.randomUUID()

  runSql(`
    insert into public.tournament (id, name, stage) values ('${tournamentId}', 'Impact integration', 'groups');
    insert into public.teams (id, tournament_id, name) values
      ('${teamA}', '${tournamentId}', 'Team A'),
      ('${teamB}', '${tournamentId}', 'Team B');
    insert into public.team_fixtures (id, tournament_id, stage, team_a_id, team_b_id)
    values ('${fixtureId}', '${tournamentId}', 'qualifying', '${teamA}', '${teamB}');
    insert into public.matches (id, fixture_id, match_number, state, result_kind, winner_side) values
      ('${matchOneId}', '${fixtureId}', 1, 'completed', 'walkover', 'a'),
      ('${matchTwoId}', '${fixtureId}', 2, 'completed', 'walkover', '${secondWinner}');
  `)
  return { fixtureId, matchOneId, matchTwoId }
}

interface SeededRoundRobin {
  finalFixtureId: string
  matchIds: Record<string, [string, string]>
  teams: Record<'a' | 'b' | 'c' | 'd', string>
  tournamentId: string
}

/**
 * A complete qualifying stage decided by walkovers, so no points count.
 * `winners` names each fixture's two match winners by side. `populate` assigns
 * the placement fixtures from the standings; a tied seed skips it, because
 * the playoff it would create needs predeclared pairs.
 */
function seedRoundRobin(
  winners: Record<'ab' | 'ac' | 'ad' | 'bc' | 'bd' | 'cd', [Side, Side]>,
  populate = true,
): SeededRoundRobin {
  const tournamentId = crypto.randomUUID()
  const teams = { a: crypto.randomUUID(), b: crypto.randomUUID(), c: crypto.randomUUID(), d: crypto.randomUUID() }
  const finalFixtureId = crypto.randomUUID()
  const matchIds: Record<string, [string, string]> = {}
  const rows = Object.entries(winners).map(([key, [first, second]]) => {
    const fixtureId = crypto.randomUUID()
    const ids: [string, string] = [crypto.randomUUID(), crypto.randomUUID()]
    matchIds[key] = ids
    const [teamA, teamB] = [teams[key[0] as keyof typeof teams], teams[key[1] as keyof typeof teams]]
    return {
      fixture: `('${fixtureId}', '${tournamentId}', 'qualifying', '${teamA}', '${teamB}')`,
      matches: [
        `('${ids[0]}', '${fixtureId}', 1, 'completed', 'walkover', '${first}')`,
        `('${ids[1]}', '${fixtureId}', 2, 'completed', 'walkover', '${second}')`,
      ],
    }
  })

  runSql(`
    insert into public.tournament (id, name, stage) values ('${tournamentId}', 'Impact integration', 'groups');
    insert into public.teams (id, tournament_id, name) values
      ('${teams.a}', '${tournamentId}', 'A'),
      ('${teams.b}', '${tournamentId}', 'B'),
      ('${teams.c}', '${tournamentId}', 'C'),
      ('${teams.d}', '${tournamentId}', 'D');
    insert into public.team_fixtures (id, tournament_id, stage, team_a_id, team_b_id) values
      ${rows.map((row) => row.fixture).join(',\n      ')},
      ('${crypto.randomUUID()}', '${tournamentId}', 'third-place', null, null),
      ('${finalFixtureId}', '${tournamentId}', 'final', null, null);
    insert into public.matches (id, fixture_id, match_number, state, result_kind, winner_side) values
      ${rows.flatMap((row) => row.matches).join(',\n      ')};
    ${populate ? 'select private.populate_placement_fixtures();' : ''}
  `)
  return { finalFixtureId, matchIds, teams, tournamentId }
}

/**
 * A 6, B 3, C 2, D 1. Awarding the first B-C match to C instead swaps B and C,
 * which changes both placement fixtures.
 */
function seedSeparatedStandings(): SeededRoundRobin {
  return seedRoundRobin({
    ab: ['a', 'a'],
    ac: ['a', 'a'],
    ad: ['a', 'a'],
    bc: ['a', 'b'],
    bd: ['a', 'a'],
    cd: ['a', 'b'],
  })
}

/** Confirms the finalists and gives the final a confirmed lineup row. */
function confirmFinalistsWithLineup(seeded: SeededRoundRobin): void {
  const [player1, player2] = [crypto.randomUUID(), crypto.randomUUID()]
  runSql(`
    update public.tournament set finalists_confirmed_at = clock_timestamp(), stage = 'knockouts'
    where id = '${seeded.tournamentId}';
    insert into public.players (id, team_id, name, seed) values
      ('${player1}', '${seeded.teams.a}', 'A1', 1),
      ('${player2}', '${seeded.teams.a}', 'A2', 2);
    insert into private.lineups (fixture_id, team_id, match_number, player_1_id, player_2_id, confirmed_at)
    values ('${seeded.finalFixtureId}', '${seeded.teams.a}', 1, '${player1}', '${player2}', clock_timestamp());
  `)
}

function correctionPayload(matchId: string, winnerSide: Side, previewVersion = 0) {
  return {
    matchId,
    winnerSide,
    games: winnerSide === 'a' ? [{ a: 21, b: 10 }] : [{ a: 10, b: 21 }],
    previewTournamentVersion: previewVersion,
  }
}

describe('team result impacts', () => {
  beforeAll(async () => {
    await requireLocalSupabase()
  })

  beforeEach(() => {
    resetLocalDatabase()
  })

  it('projects a correction without persisting it and accepts the reviewed version', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)
    const seeded = seedFixture()
    const payload = correctionPayload(seeded.matchTwoId, 'a')

    const previewResponse = await rpc('preview_result_correction', mutation(0, payload), organizer)
    expect(previewResponse.ok).toBe(true)
    const preview = (await previewResponse.json()) as Impact
    expect(preview.blockedReason).toBeNull()
    expect(preview.before).not.toEqual(preview.after)
    expect(runSql(`select winner_side from public.matches where id = '${seeded.matchTwoId}';`)).toBe('b')

    const correction = await rpc(
      'correct_result',
      mutation(0, correctionPayload(seeded.matchTwoId, 'a', preview.tournamentVersion)),
      organizer,
    )
    expect(correction.ok).toBe(true)
    expect(runSql(`select winner_side from public.matches where id = '${seeded.matchTwoId}';`)).toBe('a')
  })

  it('rejects a corrected qualifying result with more than one game', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)
    const seeded = seedFixture()
    const response = await rpc('correct_result', mutation(0, {
      ...correctionPayload(seeded.matchTwoId, 'a'),
      games: [{ a: 21, b: 10 }, { a: 21, b: 10 }],
    }), organizer)
    expect(response.ok).toBe(false)
  })

  it('blocks a qualifying correction that changes a started playoff', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)
    // A 6, then B and C level on 3 with nothing to separate them, D 0.
    const seeded = seedRoundRobin({
      ab: ['a', 'a'],
      ac: ['a', 'a'],
      ad: ['a', 'a'],
      bc: ['a', 'b'],
      bd: ['a', 'a'],
      cd: ['a', 'a'],
    }, false)
    const playoffFixture = crypto.randomUUID()
    runSql(`
      insert into public.team_fixtures (id, tournament_id, stage, team_a_id, team_b_id)
      values ('${playoffFixture}', '${seeded.tournamentId}', 'qualification-playoff', '${seeded.teams.b}', '${seeded.teams.c}');
      insert into public.matches (fixture_id, match_number, state)
      values ('${playoffFixture}', 1, 'playing');
    `)

    const preview = await rpc(
      'preview_result_correction',
      mutation(0, correctionPayload(seeded.matchIds.bc[1], 'a')),
      organizer,
    )
    expect(preview.ok).toBe(true)
    expect(await preview.json()).toMatchObject({ blockedReason: 'playoff-started', after: null })
  })

  it('revokes finalist confirmation and clears placement lineups when finalists change', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)
    const seeded = seedSeparatedStandings()
    confirmFinalistsWithLineup(seeded)
    expect(runSql(`
      select count(*) from public.team_fixtures
      where id = '${seeded.finalFixtureId}' and '${seeded.teams.b}'::uuid in (team_a_id, team_b_id);
    `)).toBe('1')

    const previewResponse = await rpc(
      'preview_result_correction',
      mutation(0, correctionPayload(seeded.matchIds.bc[0], 'b')),
      organizer,
    )
    const preview = (await previewResponse.json()) as Impact
    expect(preview.blockedReason).toBeNull()
    expect(preview.after?.tournament.finalists_confirmed_at).toBeNull()

    const correction = await rpc(
      'correct_result',
      mutation(0, correctionPayload(seeded.matchIds.bc[0], 'b', preview.tournamentVersion)),
      organizer,
    )
    expect(correction.ok).toBe(true)
    expect(runSql(`select count(*) from private.lineups where fixture_id = '${seeded.finalFixtureId}';`)).toBe('0')
    expect(runSql(`select finalists_confirmed_at is null from public.tournament where id = '${seeded.tournamentId}';`)).toBe('t')
    expect(runSql(`
      select count(*) from public.team_fixtures
      where id = '${seeded.finalFixtureId}' and '${seeded.teams.c}'::uuid in (team_a_id, team_b_id);
    `)).toBe('1')
  })

  it('blocks changed placement participants after a placement match starts', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)
    const seeded = seedSeparatedStandings()
    confirmFinalistsWithLineup(seeded)
    runSql(`
      insert into public.matches (fixture_id, match_number, state)
      values ('${seeded.finalFixtureId}', 1, 'playing');
    `)

    const preview = await rpc(
      'preview_result_correction',
      mutation(0, correctionPayload(seeded.matchIds.bc[0], 'b')),
      organizer,
    )
    expect(preview.ok).toBe(true)
    expect(await preview.json()).toMatchObject({ blockedReason: 'placement-started', after: null })
  })

  it('blocks every correction after tournament completion and rejects stale previews', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)
    const seeded = seedFixture()
    runSql("update public.tournament set stage = 'completed' where singleton;")
    const blocked = await rpc(
      'preview_result_correction',
      mutation(0, correctionPayload(seeded.matchTwoId, 'a')),
      organizer,
    )
    expect(await blocked.json()).toMatchObject({ blockedReason: 'tournament-completed' })

    runSql("update public.tournament set stage = 'groups', result_revision = 2 where singleton;")
    const stale = await rpc(
      'correct_result',
      mutation(0, correctionPayload(seeded.matchTwoId, 'a', 0)),
      organizer,
    )
    expect(stale.ok).toBe(false)
  })
})
