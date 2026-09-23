import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  anonymousRpc,
  elevate,
  type LocalSession,
  mutation,
  requireLocalSupabase,
  resetLocalDatabase,
  rpc,
  runSql,
  signInAnonymously,
} from './local-supabase.ts'

interface Player {
  id: string
  seed: 1 | 2
  team_id: string
}

interface Fixture {
  id: string
  stage: 'qualifying' | 'qualification-playoff' | 'third-place' | 'final'
  team_a_id: string | null
  team_b_id: string | null
  playoff_round_id: string | null
}

interface Match {
  court: 1 | 2 | null
  fixture_id: string
  id: string
  match_number: 1 | 2 | 3
  pair_a_player_1_id: string | null
  pair_a_player_2_id: string | null
  pair_b_player_1_id: string | null
  pair_b_player_2_id: string | null
  state: 'unstarted' | 'playing' | 'completed' | 'unnecessary'
  version: number
}

interface Snapshot {
  fixtures: Fixture[]
  matches: Match[]
  players: Player[]
  playoff_rounds: Array<{ id: string; round_number: number; team_ids: string[] }>
  tournament: { current_playoff_round_id: string | null; version: number; result_revision: number }
}

type Side = 'a' | 'b'

interface Pair {
  player1Id: string
  player2Id: string
}

function rosterPayload(): Record<string, unknown> {
  return {
    tournamentName: 'Pair assignment',
    teams: Array.from({ length: 4 }, (_, teamIndex) => ({
      name: `Team ${teamIndex + 1}`,
      players: Array.from({ length: 4 }, (_, playerIndex) => ({
        name: `Player ${teamIndex + 1}-${playerIndex + 1}`,
        seed: playerIndex < 2 ? 1 : 2,
      })),
    })),
  }
}

async function snapshot(session?: LocalSession): Promise<Snapshot> {
  const response = session
    ? await rpc('get_tournament_snapshot', {}, session)
    : await anonymousRpc('get_tournament_snapshot', {})
  expect(response.ok).toBe(true)
  const body = (await response.json()) as { snapshot: Snapshot | null }
  if (!body.snapshot) throw new Error('Tournament snapshot is empty')
  return body.snapshot
}

async function ok(response: Response): Promise<Record<string, unknown>> {
  expect(response.ok, `returned ${response.status}`).toBe(true)
  return (await response.json()) as Record<string, unknown>
}

async function message(response: Response): Promise<string> {
  expect(response.ok).toBe(false)
  const body = (await response.json()) as { message?: unknown }
  return typeof body.message === 'string' ? body.message : ''
}

async function startQualifying(organizer: LocalSession): Promise<Snapshot> {
  await ok(await rpc('save_roster', mutation(0, rosterPayload()), organizer))
  const created = await snapshot(organizer)
  await ok(await rpc('start_qualifying', mutation(created.tournament.version, {}), organizer))
  return snapshot(organizer)
}

function teamPlayers(current: Snapshot, teamId: string) {
  const players = current.players.filter((player) => player.team_id === teamId)
  return {
    seed1: players.filter((player) => player.seed === 1).map(({ id }) => id),
    seed2: players.filter((player) => player.seed === 2).map(({ id }) => id),
  }
}

function sideTeam(current: Snapshot, match: Match, side: Side): string {
  const fixture = current.fixtures.find((candidate) => candidate.id === match.fixture_id)
  const teamId = side === 'a' ? fixture?.team_a_id : fixture?.team_b_id
  if (!teamId) throw new Error('Match side has no team')
  return teamId
}

function fixtureMatches(current: Snapshot, fixtureId: string): Match[] {
  return current.matches
    .filter((match) => match.fixture_id === fixtureId)
    .sort((first, second) => first.match_number - second.match_number)
}

function currentMatch(current: Snapshot, matchId: string): Match {
  const match = current.matches.find((candidate) => candidate.id === matchId)
  if (!match) throw new Error('Match vanished')
  return match
}

function assign(
  session: LocalSession | null,
  match: Match,
  side: Side,
  pair: Pair,
  ruleException = false,
  requestId = crypto.randomUUID(),
): Promise<Response> {
  const body = mutation(match.version, { matchId: match.id, side, ruleException, ...pair }, requestId)
  return session ? rpc('assign_pair', body, session) : anonymousRpc('assign_pair', body)
}

async function assignMixed(session: LocalSession, matchId: string, sides: Side[] = ['a', 'b']): Promise<Match> {
  for (const side of sides) {
    const current = await snapshot(session)
    const match = currentMatch(current, matchId)
    const { seed1, seed2 } = teamPlayers(current, sideTeam(current, match, side))
    const index = match.match_number === 2 ? 1 : 0
    await ok(await assign(session, match, side, { player1Id: seed1[index], player2Id: seed2[index] }))
  }
  return currentMatch(await snapshot(session), matchId)
}

async function assignCourt(session: LocalSession, matchId: string, court: 1 | 2): Promise<Match> {
  const current = await snapshot(session)
  await ok(await rpc('assign_courts', mutation(current.tournament.version, {
    assignments: [{ matchId, court }],
  }), session))
  return currentMatch(await snapshot(session), matchId)
}

async function walkover(session: LocalSession, matchId: string, winnerSide: Side): Promise<void> {
  const match = currentMatch(await snapshot(session), matchId)
  await ok(await rpc('mark_walkover', mutation(match.version, { matchId, winnerSide }), session))
}

describe('pair assignment', () => {
  let organizer: LocalSession
  let referee: LocalSession

  beforeAll(async () => {
    await requireLocalSupabase()
  })

  beforeEach(async () => {
    resetLocalDatabase()
    organizer = await signInAnonymously()
    referee = await signInAnonymously()
    await elevate(organizer)
    await elevate(referee, '1357')
  })

  it('lets both staff roles assign, rejects the public, and rejects a forged referee exception', async () => {
    const ready = await startQualifying(organizer)
    const match = fixtureMatches(ready, ready.fixtures[0].id)[0]
    const { seed1, seed2 } = teamPlayers(ready, sideTeam(ready, match, 'a'))
    const mixed = { player1Id: seed1[0], player2Id: seed2[0] }

    expect([401, 403]).toContain((await assign(null, match, 'a', mixed)).status)

    const forged = await assign(referee, match, 'a', { player1Id: seed1[0], player2Id: seed1[1] }, true)
    expect(forged.status).toBe(403)
    expect(await message(forged)).toBe('Organizer access required')
    // A forged flag is rejected even when the pair would have been valid.
    expect(await message(await assign(referee, match, 'a', mixed, true))).toBe('Organizer access required')

    await ok(await assign(referee, match, 'a', mixed))
    const afterReferee = currentMatch(await snapshot(), match.id)
    expect(afterReferee).toMatchObject({ pair_a_player_1_id: seed1[0], pair_b_player_1_id: null })

    await ok(await assign(organizer, afterReferee, 'a', { player1Id: seed1[0], player2Id: seed1[1] }, true))
    expect(currentMatch(await snapshot(), match.id)).toMatchObject({
      pair_a_player_1_id: seed1[0],
      pair_a_player_2_id: seed1[1],
    })
    // Nothing in the public snapshot marks the exception.
    expect(JSON.stringify(await snapshot())).not.toMatch(/exception/i)
  })

  it('rejects invalid pairs, allowing the organizer to waive only seed and reuse rules', async () => {
    const ready = await startQualifying(organizer)
    const [first, second] = fixtureMatches(ready, ready.fixtures[0].id)
    const teamId = sideTeam(ready, first, 'a')
    const { seed1, seed2 } = teamPlayers(ready, teamId)
    const otherTeam = teamPlayers(ready, sideTeam(ready, first, 'b'))

    expect(await message(await assign(referee, first, 'a', { player1Id: seed1[0], player2Id: seed1[1] })))
      .toBe('Pair must mix seeds')
    expect(await message(await assign(organizer, first, 'a', { player1Id: seed1[0], player2Id: seed1[1] })))
      .toBe('Pair must mix seeds')
    expect(await message(await assign(organizer, first, 'a', { player1Id: seed1[0], player2Id: seed1[0] }, true)))
      .toBe('A pair requires two distinct players')
    expect(await message(await assign(organizer, first, 'a', { player1Id: seed1[0], player2Id: otherTeam.seed2[0] }, true)))
      .toBe('Pair players must belong to the team')

    await ok(await assign(referee, first, 'a', { player1Id: seed1[0], player2Id: seed2[0] }))
    expect(await message(await assign(referee, second, 'a', { player1Id: seed1[0], player2Id: seed2[1] })))
      .toBe('Player already plays in this fixture')
    // A doubled-up player needs the organizer's exception and plays sequentially.
    await ok(await assign(organizer, second, 'a', { player1Id: seed1[0], player2Id: seed2[1] }, true))
  })

  it('blocks a player already on court for everyone, at assignment and at start', async () => {
    const ready = await startQualifying(organizer)
    const [first, second] = fixtureMatches(ready, ready.fixtures[0].id)
    await assignCourt(organizer, first.id, 1)
    const playing = await assignMixed(organizer, first.id)
    await ok(await rpc('start_match', mutation(playing.version, { matchId: first.id }), organizer))

    const current = await snapshot(organizer)
    const busy = currentMatch(current, first.id).pair_a_player_1_id
    const { seed2 } = teamPlayers(current, sideTeam(current, second, 'a'))
    if (!busy) throw new Error('Playing pair is missing')
    const attempt = await assign(organizer, currentMatch(current, second.id), 'a', { player1Id: busy, player2Id: seed2[1] }, true)
    expect(await message(attempt)).toBe('A player is already playing')

    // Saved before the other match started, the overlap still blocks the start.
    runSql(`
      update public.matches
      set pair_a_player_1_id = '${busy}', pair_a_player_2_id = '${seed2[1]}'
      where id = '${second.id}';
    `)
    await assignMixed(organizer, second.id, ['b'])
    const blocked = await assignCourt(organizer, second.id, 2)
    expect(await message(await rpc('start_match', mutation(blocked.version, { matchId: second.id }), organizer)))
      .toBe('A player is already playing')
  })

  it('serializes concurrent writes, replays a request, and rejects stale versions', async () => {
    const ready = await startQualifying(organizer)
    const match = fixtureMatches(ready, ready.fixtures[0].id)[0]
    const { seed1, seed2 } = teamPlayers(ready, sideTeam(ready, match, 'a'))
    const pairOne = { player1Id: seed1[0], player2Id: seed2[0] }
    const pairTwo = { player1Id: seed1[1], player2Id: seed2[1] }

    const racing = await Promise.all([
      assign(organizer, match, 'a', pairOne),
      assign(referee, match, 'a', pairTwo),
    ])
    expect(racing.filter((response) => response.ok)).toHaveLength(1)
    const loser = racing.find((response) => !response.ok)
    if (!loser) throw new Error('Both concurrent writes succeeded')
    expect(await message(loser)).toBe('Match version conflict')

    const saved = currentMatch(await snapshot(organizer), match.id)
    const requestId = crypto.randomUUID()
    const first = await ok(await assign(organizer, saved, 'b', teamPairFor(ready, match), false, requestId))
    const replay = await ok(await assign(organizer, saved, 'b', teamPairFor(ready, match), false, requestId))
    expect(replay).toEqual(first)
    expect(await message(await assign(organizer, saved, 'b', teamPairFor(ready, match, 1), false, requestId)))
      .toBe('Request ID was already used with different input')
    expect(await message(await assign(organizer, saved, 'a', pairOne))).toBe('Match version conflict')

    // Starting and reassigning at once: whichever lands second sees a new version.
    const court = await assignCourt(organizer, match.id, 1)
    const race = await Promise.all([
      rpc('start_match', mutation(court.version, { matchId: match.id }), referee),
      assign(organizer, court, 'a', pairTwo),
    ])
    expect(race.filter((response) => response.ok)).toHaveLength(1)
  })

  it('opens placement matches only after finalist confirmation, with third-place seed rules', async () => {
    const ready = await startQualifying(organizer)
    for (const fixture of ready.fixtures.filter((candidate) => candidate.stage === 'qualifying')) {
      for (const match of fixtureMatches(ready, fixture.id)) {
        await walkover(organizer, match.id, 'a')
      }
    }
    const qualified = await snapshot(organizer)
    const thirdPlace = qualified.fixtures.find((fixture) => fixture.stage === 'third-place')
    if (!thirdPlace) throw new Error('Third-place fixture is missing')
    expect(fixtureMatches(qualified, thirdPlace.id)).toEqual([])

    await ok(await rpc('confirm_finalists', mutation(qualified.tournament.version, {}), organizer))
    const confirmed = await snapshot(organizer)
    const [opener, , decider] = fixtureMatches(confirmed, thirdPlace.id)
    const { seed1 } = teamPlayers(confirmed, sideTeam(confirmed, opener, 'a'))
    const sameSeed = { player1Id: seed1[0], player2Id: seed1[1] }

    expect(await message(await assign(referee, opener, 'a', sameSeed))).toBe('Pair must mix seeds')
    // The decider allows any two teammates, including a same-seed pair.
    await ok(await assign(referee, decider, 'a', sameSeed))

    // Revoking confirmation closes placement assignment again.
    runSql('update public.tournament set finalists_confirmed_at = null where singleton;')
    const reopened = currentMatch(await snapshot(organizer), opener.id)
    expect(await message(await assign(referee, reopened, 'b', sameSeed)))
      .toBe('Pair assignment is not open for this match')
  })

  it('keeps pre-start walkovers without inventing pairs', async () => {
    const ready = await startQualifying(organizer)
    const match = fixtureMatches(ready, ready.fixtures[0].id)[0]
    await walkover(organizer, match.id, 'b')
    expect(currentMatch(await snapshot(), match.id)).toMatchObject({
      state: 'completed',
      pair_a_player_1_id: null,
      pair_b_player_1_id: null,
    })
    expect(await message(await rpc('mark_walkover', mutation(match.version, { matchId: match.id, winnerSide: 'a' }), referee)))
      .toBe('Organizer access required')
  })

  it('creates a continuation round once, keeps earlier results, and rebuilds or blocks on correction', async () => {
    const ready = await startQualifying(organizer)
    // Teams sort by id; the last loses every match and the other three split
    // their fixtures, so all three tie for both final places.
    const [x, y, z, loser] = [...new Set(ready.players.map((player) => player.team_id))].sort()
    for (const fixture of ready.fixtures.filter((candidate) => candidate.stage === 'qualifying')) {
      const [first, second] = fixtureMatches(ready, fixture.id)
      if (fixture.team_a_id === loser || fixture.team_b_id === loser) {
        const winner = fixture.team_a_id === loser ? 'b' : 'a'
        await walkover(organizer, first.id, winner)
        await walkover(organizer, second.id, winner)
      } else {
        await walkover(organizer, first.id, 'a')
        await walkover(organizer, second.id, 'b')
      }
    }

    let current = await snapshot(organizer)
    expect(current.playoff_rounds).toHaveLength(1)
    const [firstRound] = current.playoff_rounds
    expect(firstRound).toMatchObject({ round_number: 1, team_ids: [x, y, z] })
    expect(current.tournament.current_playoff_round_id).toBe(firstRound.id)

    const roundFixture = (teamA: string, teamB: string) => {
      const fixture = current.fixtures.find((candidate) =>
        candidate.playoff_round_id === firstRound.id && candidate.team_a_id === teamA && candidate.team_b_id === teamB)
      if (!fixture) throw new Error('Round 1 fixture is missing')
      return fixtureMatches(current, fixture.id)[0]
    }
    const [xy, xz, yz] = [roundFixture(x, y), roundFixture(x, z), roundFixture(y, z)]
    // An exact cycle, 11–9 each: X beats Y, Y beats Z, Z beats X.
    runSql(`
      update public.matches set state = 'completed', result_kind = 'played',
        winner_side = case when id = '${xz.id}' then 'b' else 'a' end
      where id in ('${xy.id}', '${xz.id}', '${yz.id}');
      insert into public.match_games (match_id, game_number, score_a, score_b, confirmed_at) values
        ('${xy.id}', 1, 11, 9, clock_timestamp()),
        ('${xz.id}', 1, 9, 11, clock_timestamp()),
        ('${yz.id}', 1, 11, 9, clock_timestamp());
      select private.populate_placement_fixtures();
      select private.populate_placement_fixtures();
    `)

    current = await snapshot(organizer)
    expect(current.playoff_rounds.map(({ round_number, team_ids }) => [round_number, team_ids]))
      .toEqual([[1, [x, y, z]], [2, [x, y, z]]])
    const secondRound = current.playoff_rounds[1]
    expect(current.tournament.current_playoff_round_id).toBe(secondRound.id)
    const roundTwo = current.fixtures.filter((fixture) => fixture.playoff_round_id === secondRound.id)
    expect(roundTwo).toHaveLength(3)
    expect(roundTwo.flatMap((fixture) => fixtureMatches(current, fixture.id))).toHaveLength(3)
    expect(runSql(`
      select count(*) from public.matches
      where id in ('${xy.id}', '${xz.id}', '${yz.id}') and state = 'completed';
    `)).toBe('3')

    // Z beating Y makes round 1 decisive (Z, then X), so the replay is moot.
    const corrected = currentMatch(current, yz.id)
    const correction = mutation(corrected.version, {
      matchId: yz.id,
      winnerSide: 'b',
      games: [{ a: 9, b: 11 }],
    })
    const started = fixtureMatches(current, roundTwo[0].id)[0]
    runSql(`update public.matches set state = 'playing' where id = '${started.id}';`)
    expect(await ok(await rpc('preview_result_correction', correction, organizer)))
      .toMatchObject({ blockedReason: 'playoff-started', after: null })

    runSql(`update public.matches set state = 'unstarted' where id = '${started.id}';`)
    const allowed = await ok(await rpc('preview_result_correction', correction, organizer))
    expect(allowed.blockedReason).toBeNull()
    expect((allowed.after as Snapshot).playoff_rounds.map(({ round_number }) => round_number)).toEqual([1])
    const revision = (await snapshot(organizer)).tournament.result_revision
    await ok(await rpc('correct_result', mutation(corrected.version, {
      matchId: yz.id,
      winnerSide: 'b',
      games: [{ a: 9, b: 11 }],
      previewTournamentVersion: revision,
    }), organizer))
    const rebuilt = await snapshot(organizer)
    expect(rebuilt.playoff_rounds.map(({ round_number }) => round_number)).toEqual([1])
    const final = rebuilt.fixtures.find((fixture) => fixture.stage === 'final')
    expect([final?.team_a_id, final?.team_b_id].sort()).toEqual([x, z].sort())
  })
})

function teamPairFor(current: Snapshot, match: Match, index = 0): Pair {
  const { seed1, seed2 } = teamPlayers(current, sideTeam(current, match, 'b'))
  return { player1Id: seed1[index], player2Id: seed2[index] }
}
