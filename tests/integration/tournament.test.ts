import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

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
    setup_locked_at: string | null
    stage: 'setup' | 'groups' | 'knockouts' | 'completed'
    version: number
  }
}

function setupPayload(): Record<string, unknown> {
  return {
    setup: {
      tournamentName: 'Integration tournament',
      pairs: Array.from({ length: 6 }, (_, pairIndex) => ({
        teamName: `Pair ${pairIndex + 1}`,
        group: pairIndex < 3 ? 'A' : 'B',
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

async function createTournament(session: LocalSession): Promise<Snapshot> {
  const setup = await callMutation('save_setup', session, 0, setupPayload())
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
    await requireLocalSupabase()
  })

  beforeEach(() => {
    resetLocalDatabase()
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
    const takeover = await callMutation('take_over', taker, playingMatch.version, {
      matchId: playingMatch.id,
    })
    const staleWrite = await rpc(
      'add_point',
      mutation(takeover.matchVersion ?? -1, { matchId: playingMatch.id, side: 'a' }),
      owner,
    )
    expect(staleWrite.ok).toBe(false)
    await callMutation('add_point', taker, takeover.matchVersion ?? -1, {
      matchId: playingMatch.id,
      side: 'a',
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
