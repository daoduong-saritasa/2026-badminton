import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSupabaseClient } = vi.hoisted(() => ({ getSupabaseClient: vi.fn() }))

vi.mock('../lib/supabase', () => ({ getSupabaseClient }))

import {
  fetchTournament,
  mutateTournament,
  InvalidTournamentDataError,
  StaleTournamentSnapshotError,
  subscribeTournament,
} from './tournament'

const tournamentId = '00000000-0000-4000-8000-000000000010'
const playerAId = '00000000-0000-4000-8000-000000000011'
const playerBId = '00000000-0000-4000-8000-000000000012'
const teamId = '00000000-0000-4000-8000-000000000013'
const requestId = '00000000-0000-4000-8000-000000000014'
const fixtureId = '00000000-0000-4000-8000-000000000015'
const matchId = '00000000-0000-4000-8000-000000000016'
const otherTeamId = '00000000-0000-4000-8000-000000000017'
const playerCId = '00000000-0000-4000-8000-000000000018'
const playerDId = '00000000-0000-4000-8000-000000000019'

function match(overrides: Record<string, unknown> = {}) {
  return {
    id: matchId,
    fixture_id: fixtureId,
    match_number: 1,
    pair_a_player_1_id: playerAId,
    pair_a_player_2_id: playerBId,
    pair_b_player_1_id: playerCId,
    pair_b_player_2_id: playerDId,
    court: 1,
    state: 'playing',
    result_kind: null,
    winner_side: null,
    version: 4,
    ...overrides,
  }
}

function snapshot(version: number, overrides: Record<string, unknown> = {}) {
  return {
    tournament: {
      id: tournamentId,
      name: 'Tournament',
      stage: 'groups',
      setup_locked_at: '2026-09-09T00:00:00Z',
      version,
      result_revision: version,
      finalists_confirmed_at: null,
      qualification_draw_winner_ids: null,
    },
    teams: [
      { id: teamId, name: 'Team A' },
      { id: otherTeamId, name: 'Team B' },
    ],
    players: [
      { id: playerAId, team_id: teamId, name: 'A', seed: 1 },
      { id: playerBId, team_id: teamId, name: 'B', seed: 2 },
      { id: playerCId, team_id: otherTeamId, name: 'C', seed: 1 },
      { id: playerDId, team_id: otherTeamId, name: 'D', seed: 2 },
    ],
    fixtures: [
      { id: fixtureId, stage: 'qualifying', team_a_id: teamId, team_b_id: otherTeamId, version: 2 },
    ],
    matches: [match()],
    games: [
      { match_id: matchId, game_number: 2, score_a: 3, score_b: 1, confirmed_at: null },
      { match_id: matchId, game_number: 1, score_a: 15, score_b: 10, confirmed_at: '2026-09-09T00:10:00Z' },
    ],
    lineups: [],
    ...overrides,
  }
}

function state(version: number, resetGeneration = 0) {
  return { resetGeneration, snapshot: snapshot(version) }
}

describe('tournament data', () => {
  const rpc = vi.fn()
  const removeChannel = vi.fn()
  const channel = {
    on: vi.fn(),
    subscribe: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    channel.on.mockReturnValue(channel)
    channel.subscribe.mockReturnValue(channel)
    getSupabaseClient.mockReturnValue({ rpc, channel: vi.fn(() => channel), removeChannel })
  })

  it('maps server DTOs and rejects a response older than the accepted snapshot', async () => {
    rpc.mockResolvedValueOnce({ data: state(1), error: null })
    await expect(fetchTournament()).resolves.toMatchObject({
      resetGeneration: 0,
      snapshot: {
        tournament: { id: tournamentId, setupLockedAt: '2026-09-09T00:00:00Z', version: 1 },
        teams: [{ id: teamId, name: 'Team A' }, { id: otherTeamId, name: 'Team B' }],
        players: [{ id: playerAId, teamId, seed: 1 }, { id: playerBId, teamId, seed: 2 }, { id: playerCId }, { id: playerDId }],
        fixtures: [{ id: fixtureId, stage: 'qualifying', teamAId: teamId, teamBId: otherTeamId }],
        matches: [{
          id: matchId,
          matchNumber: 1,
          pairA: { player1Id: playerAId, player2Id: playerBId },
          pairB: { player1Id: playerCId, player2Id: playerDId },
          court: 1,
          games: [
            { gameNumber: 1, score: { a: 15, b: 10 }, confirmedAt: '2026-09-09T00:10:00Z' },
            { gameNumber: 2, score: { a: 3, b: 1 }, confirmedAt: null },
          ],
        }],
      },
    })

    rpc.mockResolvedValueOnce({ data: state(0), error: null })
    await expect(fetchTournament()).rejects.toBeInstanceOf(StaleTournamentSnapshotError)
  })

  it('rejects a completed match without a winner', async () => {
    rpc.mockResolvedValueOnce({
      data: { resetGeneration: 9, snapshot: snapshot(0, { matches: [match({ state: 'completed' })] }) },
      error: null,
    })
    await expect(fetchTournament()).rejects.toBeInstanceOf(InvalidTournamentDataError)
  })

  it('rejects a lineup that does not carry four pairs', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        resetGeneration: 9,
        snapshot: snapshot(0, {
          lineups: [{
            fixtureId,
            teamId,
            pairs: [{ player1Id: playerAId, player2Id: playerBId }],
            confirmedAt: null,
          }],
        }),
      },
      error: null,
    })
    await expect(fetchTournament()).rejects.toBeInstanceOf(InvalidTournamentDataError)
  })

  it('returns the reset generation when no tournament is configured', async () => {
    rpc.mockResolvedValueOnce({ data: { resetGeneration: 1, snapshot: null }, error: null })
    await expect(fetchTournament()).resolves.toEqual({ resetGeneration: 1, snapshot: null })
  })

  it('refetches through the acknowledged version before resolving a mutation', async () => {
    rpc
      .mockResolvedValueOnce({
        data: {
          requestId,
          resetGeneration: 1,
          tournamentVersion: 2,
          matchId: null,
          matchVersion: null,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: state(2, 1), error: null })

    await expect(
      mutateTournament('start_qualifying', {
        requestId,
        resetGeneration: 1,
        expectedVersion: 1,
        payload: {},
      }),
    ).resolves.toMatchObject({ requestId, resetGeneration: 1, tournamentVersion: 2 })
    expect(rpc).toHaveBeenNthCalledWith(1, 'start_qualifying', {
      p_request_id: requestId,
      p_reset_generation: 1,
      p_expected_version: 1,
      p_payload: {},
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'get_tournament_snapshot')
  })

  it('sends a versioned court assignment mutation', async () => {
    rpc
      .mockResolvedValueOnce({
        data: { requestId, resetGeneration: 1, tournamentVersion: 2, matchId: null, matchVersion: null },
        error: null,
      })
      .mockResolvedValueOnce({ data: state(2, 1), error: null })

    await mutateTournament('assign_courts', {
      requestId,
      resetGeneration: 1,
      expectedVersion: 1,
      payload: { assignments: [{ matchId, court: 2 }] },
    })

    expect(rpc).toHaveBeenNthCalledWith(1, 'assign_courts', {
      p_request_id: requestId,
      p_reset_generation: 1,
      p_expected_version: 1,
      p_payload: { assignments: [{ matchId, court: 2 }] },
    })
  })

  it('refreshes after Realtime reconnect and cleans up the channel', async () => {
    let statusHandler: ((status: string) => void) | undefined
    channel.subscribe.mockImplementation((handler: (status: string) => void) => {
      statusHandler = handler
      return channel
    })
    const onChange = vi.fn()
    const unsubscribe = subscribeTournament(onChange)

    statusHandler?.('SUBSCRIBED')
    statusHandler?.('CHANNEL_ERROR')
    rpc.mockResolvedValueOnce({ data: state(3, 1), error: null })
    statusHandler?.('SUBSCRIBED')

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce())
    expect(rpc).toHaveBeenCalledWith('get_tournament_snapshot')
    unsubscribe()
    unsubscribe()
    expect(removeChannel).toHaveBeenCalledOnce()
  })

  it('keeps a remaining subscriber connected when another unsubscribes', () => {
    const firstChannel = { on: vi.fn(), subscribe: vi.fn() }
    const secondChannel = { on: vi.fn(), subscribe: vi.fn() }
    let secondInvalidation: (() => void) | undefined
    firstChannel.on.mockImplementation(() => firstChannel)
    firstChannel.subscribe.mockReturnValue(firstChannel)
    secondChannel.on.mockImplementation(
      (_event: string, _filter: unknown, handler: () => void) => {
        secondInvalidation = handler
        return secondChannel
      },
    )
    secondChannel.subscribe.mockReturnValue(secondChannel)
    const createChannel = vi.fn()
      .mockReturnValueOnce(firstChannel)
      .mockReturnValueOnce(secondChannel)
    getSupabaseClient.mockReturnValue({ rpc, channel: createChannel, removeChannel })

    const firstListener = vi.fn()
    const secondListener = vi.fn()
    const unsubscribeFirst = subscribeTournament(firstListener)
    const unsubscribeSecond = subscribeTournament(secondListener)
    expect(createChannel.mock.calls[0]?.[0]).not.toBe(createChannel.mock.calls[1]?.[0])

    unsubscribeFirst()
    secondInvalidation?.()
    expect(firstListener).not.toHaveBeenCalled()
    expect(secondListener).toHaveBeenCalledOnce()
    expect(removeChannel).toHaveBeenCalledWith(firstChannel)

    unsubscribeSecond()
    expect(removeChannel).toHaveBeenCalledWith(secondChannel)
  })
  it('hands a mutation\'s snapshot to subscribers so one command costs one snapshot read', async () => {
    let changeHandler: ((payload: unknown) => void) | undefined
    channel.on.mockImplementation((_event: string, _filter: unknown, handler: (payload: unknown) => void) => {
      changeHandler = handler
      return channel
    })
    const onChange = vi.fn()
    const unsubscribe = subscribeTournament(onChange)
    rpc
      .mockResolvedValueOnce({ data: { requestId, resetGeneration: 1, tournamentVersion: 10, matchId: null, matchVersion: null }, error: null })
      .mockResolvedValueOnce({ data: state(10, 1), error: null })

    await mutateTournament('start_qualifying', { requestId, resetGeneration: 1, expectedVersion: 9, payload: {} })

    expect(rpc).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      resetGeneration: 1,
      snapshot: expect.objectContaining({ tournament: expect.objectContaining({ version: 10 }) }),
    }))
    expect(changeHandler).toBeTypeOf('function')
    unsubscribe()
  })

  it('ignores a Realtime echo of a version it already holds', () => {
    let changeHandler: ((payload: unknown) => void) | undefined
    channel.on.mockImplementation((_event: string, filter: { table?: string }, handler: (payload: unknown) => void) => {
      if (filter.table === 'tournament') changeHandler = handler
      return channel
    })
    const onChange = vi.fn()
    const unsubscribe = subscribeTournament(onChange)

    changeHandler?.({ new: { version: 10 } })
    expect(onChange).not.toHaveBeenCalled()

    changeHandler?.({ new: { version: 11 } })
    expect(onChange).toHaveBeenCalledExactlyOnceWith(undefined)

    unsubscribe()
  })

  it('subscribes to tournament state and reset-generation changes', () => {
    const unsubscribe = subscribeTournament(vi.fn())

    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tournament' },
      expect.any(Function),
    )
    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tournament_generation' },
      expect.any(Function),
    )
    unsubscribe()
  })

  it('accepts reset-to-empty and recreation while rejecting a delayed older generation', async () => {
    let resolveOlder: ((value: { data: unknown; error: null }) => void) | undefined
    const older = new Promise<{ data: unknown; error: null }>((resolve) => {
      resolveOlder = resolve
    })
    rpc
      .mockReturnValueOnce(older)
      .mockResolvedValueOnce({ data: { resetGeneration: 3, snapshot: null }, error: null })
      .mockResolvedValueOnce({ data: state(0, 3), error: null })

    const delayedFetch = fetchTournament()
    await expect(fetchTournament()).resolves.toEqual({ resetGeneration: 3, snapshot: null })
    await expect(fetchTournament()).resolves.toMatchObject({
      resetGeneration: 3,
      snapshot: { tournament: { id: tournamentId, version: 0 } },
    })

    resolveOlder?.({ data: state(99, 2), error: null })
    await expect(delayedFetch).rejects.toBeInstanceOf(StaleTournamentSnapshotError)
  })

  it('rejects a delayed empty response after recreation in the same generation', async () => {
    let resolveEmpty: ((value: { data: unknown; error: null }) => void) | undefined
    const empty = new Promise<{ data: unknown; error: null }>((resolve) => {
      resolveEmpty = resolve
    })
    rpc
      .mockReturnValueOnce(empty)
      .mockResolvedValueOnce({ data: state(0, 4), error: null })

    const delayedEmpty = fetchTournament()
    await expect(fetchTournament()).resolves.toMatchObject({ resetGeneration: 4, snapshot: { tournament: { version: 0 } } })

    resolveEmpty?.({ data: { resetGeneration: 4, snapshot: null }, error: null })
    await expect(delayedEmpty).rejects.toBeInstanceOf(StaleTournamentSnapshotError)
  })

  it('resolves a committed mutation when an overlapping refetch finishes first', async () => {
    let resolveRefresh: ((value: { data: unknown; error: null }) => void) | undefined
    const refresh = new Promise<{ data: unknown; error: null }>((resolve) => {
      resolveRefresh = resolve
    })
    rpc
      .mockResolvedValueOnce({ data: { requestId, resetGeneration: 5, tournamentVersion: 3, matchId: null, matchVersion: null }, error: null })
      .mockReturnValueOnce(refresh)
      .mockResolvedValueOnce({ data: state(3, 5), error: null })

    const committed = mutateTournament('start_qualifying', { requestId, resetGeneration: 5, expectedVersion: 2, payload: {} })
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(2))
    await expect(fetchTournament()).resolves.toMatchObject({ resetGeneration: 5, snapshot: { tournament: { version: 3 } } })

    resolveRefresh?.({ data: state(3, 5), error: null })
    await expect(committed).resolves.toMatchObject({ requestId, resetGeneration: 5, tournamentVersion: 3 })
  })
})
