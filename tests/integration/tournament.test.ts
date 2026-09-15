import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import flexibleSetupMigration from '../../supabase/migrations/202609150001_flexible_setup.sql?raw'

import {
  elevate,
  type LocalSession,
  mutation,
  requireLocalSupabase,
  resetLocalDatabase,
  rpc,
  runSql,
  signInAnonymously,
} from './local-supabase.ts'

interface Receipt {
  matchId: string | null
  matchVersion: number | null
  requestId: string
  tournamentVersion: number
}

interface SnapshotPair {
  group_code: 'A' | 'B'
  id: string
  withdrawn: boolean
}

interface SnapshotMatch {
  court: 1 | 2 | null
  group_code: 'A' | 'B' | null
  id: string
  pair_a_id: string | null
  pair_b_id: string | null
  playing_order: number
  result_kind: 'played' | 'walkover' | null
  round: 'group' | 'semifinal' | 'final'
  score_a: number | null
  score_b: number | null
  state: 'unstarted' | 'playing' | 'completed' | 'void'
  version: number
  winner_id: string | null
}

interface Snapshot {
  matches: SnapshotMatch[]
  pairs: SnapshotPair[]
  tieResolutions: unknown[]
  tournament: {
    court_count: 1 | 2 | null
    setup_locked_at: string | null
    stage: 'setup' | 'groups' | 'knockouts' | 'completed'
    version: number
  }
}

function setupPayload(
  pairCount = 6,
  courtCount: 1 | 2 | null = 2,
  largerGroup: 'A' | 'B' = 'A',
): Record<string, unknown> {
  const smallerGroupSize = Math.floor(pairCount / 2)
  const groupASize = pairCount % 2 === 0 || largerGroup === 'A'
    ? pairCount - smallerGroupSize
    : smallerGroupSize
  return {
    setup: {
      tournamentName: 'Integration tournament',
      courtCount,
      pairs: Array.from({ length: pairCount }, (_, pairIndex) => ({
        teamName: `Pair ${pairIndex + 1}`,
        group: pairIndex < groupASize ? 'A' : 'B',
        players: [
          { name: `Player ${pairIndex * 2 + 1}`, seed: 1 },
          { name: `Player ${pairIndex * 2 + 2}`, seed: 2 },
        ],
      })),
    },
  }
}

async function readSnapshot(session: LocalSession): Promise<Snapshot> {
  const response = await rpc('get_tournament_snapshot', {}, session)
  expect(response.ok).toBe(true)
  return (await response.json()) as Snapshot
}

async function callMutation(
  operation: string,
  session: LocalSession,
  expectedVersion: number,
  payload: Record<string, unknown>,
  requestId?: string,
): Promise<Receipt> {
  const response = await rpc(operation, mutation(expectedVersion, payload, requestId), session)
  expect(response.ok, `${operation} returned ${response.status}`).toBe(true)
  return (await response.json()) as Receipt
}

async function createTournament(
  session: LocalSession,
  pairCount = 6,
  courtCount: 1 | 2 = 2,
): Promise<Snapshot> {
  const setup = await callMutation('save_setup', session, 0, setupPayload(pairCount, courtCount))
  await callMutation('generate_fixtures', session, setup.tournamentVersion, {})
  return readSnapshot(session)
}

function winningScore(match: SnapshotMatch, winnerId: string, loserScore = 10): { a: number; b: number } {
  return match.pair_a_id === winnerId ? { a: 21, b: loserScore } : { a: loserScore, b: 21 }
}

async function enterGroupResults(
  session: LocalSession,
  snapshot: Snapshot,
): Promise<{ correctedMatchId: string; tiedGroupOrder: string[] }> {
  const pairsByGroup = new Map<'A' | 'B', string[]>()
  for (const group of ['A', 'B'] as const) {
    pairsByGroup.set(
      group,
      snapshot.pairs
        .filter((pair) => pair.group_code === group)
        .map((pair) => pair.id)
        .sort(),
    )
  }

  const groupAMatches = snapshot.matches.filter(
    (match) => match.round === 'group' && match.group_code === 'A',
  )
  const groupAOrder = pairsByGroup.get('A') ?? []
  for (const match of groupAMatches) {
    const winnerId = groupAOrder.find(
      (pairId) => pairId === match.pair_a_id || pairId === match.pair_b_id,
    )
    if (!winnerId) throw new Error('Group A fixture has no ranked participant')
    await callMutation('enter_result', session, match.version, {
      matchId: match.id,
      score: winningScore(match, winnerId),
    })
  }

  const groupBOrder = pairsByGroup.get('B') ?? []
  if (groupBOrder.length !== 3) throw new Error('Group B does not contain three pairs')
  const cyclicWinner = new Map<string, string>([
    [`${groupBOrder[0]}:${groupBOrder[1]}`, groupBOrder[0]],
    [`${groupBOrder[1]}:${groupBOrder[2]}`, groupBOrder[1]],
    [`${groupBOrder[0]}:${groupBOrder[2]}`, groupBOrder[2]],
  ])
  for (const match of snapshot.matches.filter(
    (candidate) => candidate.round === 'group' && candidate.group_code === 'B',
  )) {
    const participants = [match.pair_a_id, match.pair_b_id].sort().join(':')
    const winnerId = cyclicWinner.get(participants)
    if (!winnerId) throw new Error('Group B fixture is missing its cyclic winner')
    await callMutation('enter_result', session, match.version, {
      matchId: match.id,
      score: winningScore(match, winnerId, 19),
    })
  }

  const correctedMatchId = groupAMatches[0]?.id
  if (!correctedMatchId) throw new Error('No group match is available for correction')
  return { correctedMatchId, tiedGroupOrder: groupBOrder }
}

describe('tournament transactions', () => {
  beforeAll(async () => {
    expect(flexibleSetupMigration).toContain('create or replace function public.set_court_count')
    await requireLocalSupabase()
  })

  beforeEach(() => {
    resetLocalDatabase()
  })

  it.each([
    [4, 'A'], [5, 'A'], [5, 'B'], [6, 'A'], [7, 'A'], [7, 'B'],
    [8, 'A'], [9, 'A'], [9, 'B'], [10, 'A'],
  ] as const)('accepts %i balanced pairs with Group %s larger when needed', async (pairCount, largerGroup) => {
    const staff = await signInAnonymously()
    await elevate(staff)
    const receipt = await callMutation('save_setup', staff, 0, setupPayload(pairCount, 2, largerGroup))
    expect(receipt.tournamentVersion).toBe(1)
  })

  it('rejects unsupported and unbalanced setup and requires a court choice for fixtures', async () => {
    const staff = await signInAnonymously()
    await elevate(staff)

    for (const pairCount of [3, 11]) {
      const response = await rpc('save_setup', mutation(0, setupPayload(pairCount)), staff)
      expect(response.ok).toBe(false)
    }

    const unbalanced = setupPayload(6) as { setup: { pairs: { group: string }[] } }
    unbalanced.setup.pairs[4]!.group = 'A'
    expect((await rpc('save_setup', mutation(0, unbalanced), staff)).ok).toBe(false)

    const setup = await callMutation('save_setup', staff, 0, setupPayload(6, null))
    expect((await rpc('generate_fixtures', mutation(setup.tournamentVersion, {}), staff)).ok).toBe(false)
  })

  it.each([1, 2] as const)('generates fixtures for the configured %i-court schedule', async (courtCount) => {
    const staff = await signInAnonymously()
    await elevate(staff)
    const snapshot = await createTournament(staff, 10, courtCount)

    expect(snapshot.matches).toHaveLength(23)
    expect(snapshot.matches.every((match) => match.court !== null && match.court <= courtCount)).toBe(true)
    if (courtCount === 2) expect(snapshot.matches.some((match) => match.court === 2)).toBe(true)

    const final = snapshot.matches.find((match) => match.round === 'final')
    if (!final) throw new Error('Final fixture was not generated')
    expect((await rpc('start_scoring', mutation(final.version, { matchId: final.id }), staff)).ok).toBe(false)
  })

  it('changes court count idempotently and preserves completed Court 2 history', async () => {
    const staff = await signInAnonymously()
    await elevate(staff)
    let snapshot = await createTournament(staff)
    const courtTwo = snapshot.matches.filter((match) => match.court === 2 && match.round === 'group')
    const completed = courtTwo[0]
    const queued = courtTwo[1]
    if (!completed || !queued) throw new Error('Court 2 queue is incomplete')

    await callMutation('enter_result', staff, completed.version, {
      matchId: completed.id,
      score: { a: 21, b: 10 },
    })
    snapshot = await readSnapshot(staff)
    const requestId = crypto.randomUUID()
    const reduced = await callMutation('set_court_count', staff, snapshot.tournament.version, { courtCount: 1 }, requestId)
    const replay = await callMutation('set_court_count', staff, snapshot.tournament.version, { courtCount: 1 }, requestId)
    expect(replay).toEqual(reduced)

    snapshot = await readSnapshot(staff)
    expect(snapshot.tournament.court_count).toBe(1)
    expect(snapshot.matches.find((match) => match.id === completed.id)?.court).toBe(2)
    expect(snapshot.matches.find((match) => match.id === queued.id)?.court).toBe(1)
    expect((await rpc('set_court_count', mutation(snapshot.tournament.version - 1, { courtCount: 2 }), staff)).ok).toBe(false)

    const assignmentsBeforeIncrease = snapshot.matches.map(({ id, court, playing_order }) => ({ id, court, playing_order }))
    await callMutation('set_court_count', staff, snapshot.tournament.version, { courtCount: 2 })
    snapshot = await readSnapshot(staff)
    expect(snapshot.matches.map(({ id, court, playing_order }) => ({ id, court, playing_order }))).toEqual(assignmentsBeforeIncrease)
  })

  it('blocks reduction while Court 2 plays and serializes start against reassignment', async () => {
    const staff = await signInAnonymously()
    await elevate(staff)
    let snapshot = await createTournament(staff)
    const courtTwo = snapshot.matches.find((match) => match.court === 2 && match.round === 'group')
    if (!courtTwo) throw new Error('Court 2 fixture was not generated')

    await callMutation('start_scoring', staff, courtTwo.version, { matchId: courtTwo.id })
    snapshot = await readSnapshot(staff)
    expect((await rpc('set_court_count', mutation(snapshot.tournament.version, { courtCount: 1 }), staff)).ok).toBe(false)
    expect((await rpc('assign_courts', mutation(snapshot.tournament.version, {
      assignments: [{ matchId: courtTwo.id, court: 1, playingOrder: 99 }],
    }), staff)).ok).toBe(false)

    resetLocalDatabase()
    await elevate(staff)
    snapshot = await createTournament(staff)
    const unstarted = snapshot.matches.find((match) => match.round === 'group')
    if (!unstarted) throw new Error('Group fixture was not generated')
    const outcomes = await Promise.all([
      rpc('start_scoring', mutation(unstarted.version, { matchId: unstarted.id }), staff),
      rpc('assign_courts', mutation(snapshot.tournament.version, {
        assignments: [{ matchId: unstarted.id, court: unstarted.court, playingOrder: 99 }],
      }), staff),
    ])
    expect(outcomes.filter((response) => response.ok)).toHaveLength(1)
  })

  it('serializes claims, rejects court conflicts, and transfers ownership explicitly', async () => {
    const firstStaff = await signInAnonymously()
    const secondStaff = await signInAnonymously()
    await elevate(firstStaff)
    await elevate(secondStaff)
    const initial = await createTournament(firstStaff)
    const firstMatch = initial.matches.find((match) => match.round === 'group')
    if (!firstMatch) throw new Error('No group fixture was generated')

    const competingStarts = await Promise.all([
      rpc('start_scoring', mutation(firstMatch.version, { matchId: firstMatch.id }), firstStaff),
      rpc('start_scoring', mutation(firstMatch.version, { matchId: firstMatch.id }), secondStaff),
    ])
    expect(competingStarts.filter((response) => response.ok)).toHaveLength(1)

    const afterStart = await readSnapshot(firstStaff)
    const playingMatch = afterStart.matches.find((match) => match.id === firstMatch.id)
    if (!playingMatch) throw new Error('Started match disappeared')
    const sameCourtMatch = afterStart.matches.find(
      (match) =>
        match.round === 'group' &&
        match.id !== playingMatch.id &&
        match.court === playingMatch.court &&
        match.state === 'unstarted',
    )
    if (!sameCourtMatch) throw new Error('No same-court fixture was generated')

    const courtConflict = await rpc(
      'start_scoring',
      mutation(sameCourtMatch.version, { matchId: sameCourtMatch.id }),
      secondStaff,
    )
    expect(courtConflict.ok).toBe(false)

    const owner = competingStarts[0]?.ok ? firstStaff : secondStaff
    const taker = owner === firstStaff ? secondStaff : firstStaff
    const ownerPointRequest = crypto.randomUUID()
    const ownerPoint = await callMutation(
      'add_point',
      owner,
      playingMatch.version,
      { matchId: playingMatch.id, side: 'a' },
      ownerPointRequest,
    )
    const takeover = await callMutation('take_over', taker, ownerPoint.matchVersion ?? -1, {
      matchId: playingMatch.id,
    })
    const staleReplay = await rpc(
      'add_point',
      mutation(
        playingMatch.version,
        { matchId: playingMatch.id, side: 'a' },
        ownerPointRequest,
      ),
      owner,
    )
    expect(staleReplay.ok).toBe(false)
    await callMutation('add_point', taker, takeover.matchVersion ?? -1, {
      matchId: playingMatch.id,
      side: 'a',
    })
  })

  it('swaps occupied court slots without transient unique-index conflicts', async () => {
    const staff = await signInAnonymously()
    await elevate(staff)
    const initial = await createTournament(staff)
    const [firstMatch, secondMatch] = initial.matches.filter(
      (match) => match.round === 'group' && match.court !== null,
    )
    if (!firstMatch?.court || !secondMatch?.court) {
      throw new Error('Insufficient assigned group fixtures were generated')
    }

    await callMutation('assign_courts', staff, initial.tournament.version, {
      assignments: [
        {
          matchId: firstMatch.id,
          court: secondMatch.court,
          playingOrder: secondMatch.playing_order,
        },
        {
          matchId: secondMatch.id,
          court: firstMatch.court,
          playingOrder: firstMatch.playing_order,
        },
      ],
    })

    const swapped = await readSnapshot(staff)
    const firstAfter = swapped.matches.find((match) => match.id === firstMatch.id)
    const secondAfter = swapped.matches.find((match) => match.id === secondMatch.id)
    expect(firstAfter).toMatchObject({
      court: secondMatch.court,
      playing_order: secondMatch.playing_order,
      version: firstMatch.version + 1,
    })
    expect(secondAfter).toMatchObject({
      court: firstMatch.court,
      playing_order: firstMatch.playing_order,
      version: secondMatch.version + 1,
    })
  })

  it('deduplicates retries and enforces undo and winning-score boundaries', async () => {
    const staff = await signInAnonymously()
    await elevate(staff)
    const initial = await createTournament(staff)
    const [firstMatch, secondMatch] = initial.matches.filter((match) => match.round === 'group')
    if (!firstMatch || !secondMatch) throw new Error('Insufficient group fixtures were generated')

    const start = await callMutation('start_scoring', staff, firstMatch.version, {
      matchId: firstMatch.id,
    })
    const requestId = crypto.randomUUID()
    const firstPoint = await callMutation(
      'add_point',
      staff,
      start.matchVersion ?? -1,
      { matchId: firstMatch.id, side: 'a' },
      requestId,
    )
    const replayedPoint = await callMutation(
      'add_point',
      staff,
      start.matchVersion ?? -1,
      { matchId: firstMatch.id, side: 'a' },
      requestId,
    )
    expect(replayedPoint).toEqual(firstPoint)

    const changedVersionReplay = await rpc(
      'add_point',
      mutation(
        (start.matchVersion ?? -1) + 1,
        { matchId: firstMatch.id, side: 'a' },
        requestId,
      ),
      staff,
    )
    expect(changedVersionReplay.ok).toBe(false)

    const mismatchedReplay = await rpc(
      'add_point',
      mutation(start.matchVersion ?? -1, { matchId: firstMatch.id, side: 'b' }, requestId),
      staff,
    )
    expect(mismatchedReplay.ok).toBe(false)

    const undo = await callMutation('undo_point', staff, firstPoint.matchVersion ?? -1, {
      matchId: firstMatch.id,
    })
    const emptyUndo = await rpc(
      'undo_point',
      mutation(undo.matchVersion ?? -1, { matchId: firstMatch.id }),
      staff,
    )
    expect(emptyUndo.ok).toBe(false)

    runSql(
      `update public.matches set score_a = 20, score_b = 19 ` +
        `where id = '${firstMatch.id}'::uuid;`,
    )
    const winningPoint = await callMutation('add_point', staff, undo.matchVersion ?? -1, {
      matchId: firstMatch.id,
      side: 'a',
    })
    const afterWin = await rpc(
      'add_point',
      mutation(winningPoint.matchVersion ?? -1, { matchId: firstMatch.id, side: 'b' }),
      staff,
    )
    expect(afterWin.ok).toBe(false)
    const confirmRequest = crypto.randomUUID()
    const confirmed = await callMutation(
      'confirm_result',
      staff,
      winningPoint.matchVersion ?? -1,
      { matchId: firstMatch.id },
      confirmRequest,
    )
    const confirmedReplay = await callMutation(
      'confirm_result',
      staff,
      winningPoint.matchVersion ?? -1,
      { matchId: firstMatch.id },
      confirmRequest,
    )
    expect(confirmedReplay).toEqual(confirmed)

    const invalidDirect = await rpc(
      'enter_result',
      mutation(secondMatch.version, { matchId: secondMatch.id, score: { a: 21, b: 20 } }),
      staff,
    )
    expect(invalidDirect.ok).toBe(false)
    await callMutation('enter_result', staff, secondMatch.version, {
      matchId: secondMatch.id,
      score: { a: 21, b: 19 },
    })
  })

  it('recomputes group dependencies and reopens a completed final without unlocking setup', async () => {
    const staff = await signInAnonymously()
    await elevate(staff)
    const initial = await createTournament(staff)
    const { correctedMatchId, tiedGroupOrder } = await enterGroupResults(staff, initial)

    let current = await readSnapshot(staff)
    const unresolvedConfirmation = await rpc(
      'confirm_groups',
      mutation(current.tournament.version, {}),
      staff,
    )
    expect(unresolvedConfirmation.ok).toBe(false)
    await callMutation('resolve_tie', staff, current.tournament.version, {
      group: 'B',
      orderedPairIds: tiedGroupOrder,
      explanation: 'Deterministic integration-test order',
    })
    current = await readSnapshot(staff)
    await callMutation('confirm_groups', staff, current.tournament.version, {})

    current = await readSnapshot(staff)
    expect(current.tournament.stage).toBe('knockouts')
    const correctedMatch = current.matches.find((match) => match.id === correctedMatchId)
    if (!correctedMatch?.winner_id) throw new Error('Completed group match has no winner')
    await callMutation('correct_result', staff, correctedMatch.version, {
      matchId: correctedMatch.id,
      score: winningScore(correctedMatch, correctedMatch.winner_id, 11),
    })

    current = await readSnapshot(staff)
    expect(current.tournament.stage).toBe('groups')
    expect(
      current.matches
        .filter((match) => match.round === 'semifinal')
        .every((match) => match.pair_a_id === null && match.pair_b_id === null),
    ).toBe(true)

    const withdrawnPair = current.pairs.find(
      (pair) =>
        pair.group_code === 'A' &&
        pair.id !== correctedMatch.pair_a_id &&
        pair.id !== correctedMatch.pair_b_id,
    )
    if (!withdrawnPair) throw new Error('No pair is available for withdrawal')
    await callMutation('withdraw_pair', staff, current.tournament.version, {
      pairId: withdrawnPair.id,
    })
    current = await readSnapshot(staff)
    await callMutation('confirm_groups', staff, current.tournament.version, {})

    current = await readSnapshot(staff)
    const firstSemifinal = current.matches.find((match) => match.round === 'semifinal')
    if (!firstSemifinal) throw new Error('No semifinal was generated')
    const start = await callMutation('start_scoring', staff, firstSemifinal.version, {
      matchId: firstSemifinal.id,
    })
    const blockedCorrection = await rpc(
      'correct_result',
      mutation(correctedMatch.version + 1, {
        matchId: correctedMatch.id,
        score: winningScore(correctedMatch, correctedMatch.winner_id, 12),
      }),
      staff,
    )
    expect(blockedCorrection.ok).toBe(false)

    runSql(
      `update public.matches set score_a = 21, score_b = 10 ` +
        `where id = '${firstSemifinal.id}'::uuid;`,
    )
    await callMutation('confirm_result', staff, start.matchVersion ?? -1, {
      matchId: firstSemifinal.id,
    })

    current = await readSnapshot(staff)
    const secondSemifinal = current.matches.find(
      (match) => match.round === 'semifinal' && match.id !== firstSemifinal.id,
    )
    if (!secondSemifinal?.pair_a_id) throw new Error('Second semifinal has no participants')
    await callMutation('mark_walkover', staff, secondSemifinal.version, {
      matchId: secondSemifinal.id,
      winnerId: secondSemifinal.pair_a_id,
    })

    current = await readSnapshot(staff)
    const finalMatch = current.matches.find((match) => match.round === 'final')
    if (!finalMatch) throw new Error('No final was generated')
    await callMutation('enter_result', staff, finalMatch.version, {
      matchId: finalMatch.id,
      score: { a: 21, b: 18 },
    })

    current = await readSnapshot(staff)
    expect(current.tournament.stage).toBe('completed')
    expect(current.tournament.setup_locked_at).not.toBeNull()
    await callMutation('reopen_tournament', staff, current.tournament.version, {})
    current = await readSnapshot(staff)
    expect(current.tournament.stage).toBe('knockouts')
    expect(current.tournament.setup_locked_at).not.toBeNull()
    expect(current.matches.find((match) => match.round === 'final')?.state).toBe('unstarted')
  })
})
