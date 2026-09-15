import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSupabaseClient } = vi.hoisted(() => ({ getSupabaseClient: vi.fn() }))

vi.mock('../lib/supabase', () => ({ getSupabaseClient }))

import {
  fetchTournament,
  mutateTournament,
  StaleTournamentSnapshotError,
  subscribeTournament,
} from './tournament'

const tournamentId = '00000000-0000-4000-8000-000000000010'
const playerAId = '00000000-0000-4000-8000-000000000011'
const playerBId = '00000000-0000-4000-8000-000000000012'
const pairId = '00000000-0000-4000-8000-000000000013'
const requestId = '00000000-0000-4000-8000-000000000014'

function snapshot(version: number) {
  return {
    tournament: {
      id: tournamentId,
      name: 'Tournament',
      stage: 'groups',
      setup_locked_at: '2026-09-09T00:00:00Z',
      court_count: 2,
      version,
    },
    players: [
      { id: playerAId, name: 'A', seed: 1 },
      { id: playerBId, name: 'B', seed: 2 },
    ],
    pairs: [
      {
        id: pairId,
        team_name: null,
        player_a_id: playerAId,
        player_b_id: playerBId,
        group_code: 'A',
        withdrawn: false,
      },
    ],
    matches: [],
    tieResolutions: [],
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
        tournament: { id: tournamentId, setupLockedAt: '2026-09-09T00:00:00Z', courtCount: 2, version: 1 },
        pairs: [{ id: pairId, playerAId, playerBId, group: 'A' }],
      },
    })

    rpc.mockResolvedValueOnce({ data: state(0), error: null })
    await expect(fetchTournament()).rejects.toBeInstanceOf(StaleTournamentSnapshotError)
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
      mutateTournament('generate_fixtures', {
        requestId,
        resetGeneration: 1,
        expectedVersion: 1,
        payload: {},
      }),
    ).resolves.toMatchObject({ requestId, resetGeneration: 1, tournamentVersion: 2 })
    expect(rpc).toHaveBeenNthCalledWith(1, 'generate_fixtures', {
      p_request_id: requestId,
      p_reset_generation: 1,
      p_expected_version: 1,
      p_payload: {},
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'get_tournament_snapshot')
  })

  it('sends a versioned court-count mutation', async () => {
    rpc
      .mockResolvedValueOnce({
        data: { requestId, resetGeneration: 1, tournamentVersion: 2, matchId: null, matchVersion: null },
        error: null,
      })
      .mockResolvedValueOnce({ data: state(2, 1), error: null })

    await mutateTournament('set_court_count', {
      requestId,
      resetGeneration: 1,
      expectedVersion: 1,
      payload: { courtCount: 1 },
    })

    expect(rpc).toHaveBeenNthCalledWith(1, 'set_court_count', {
      p_request_id: requestId,
      p_reset_generation: 1,
      p_expected_version: 1,
      p_payload: { courtCount: 1 },
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

    await mutateTournament('generate_fixtures', { requestId, resetGeneration: 1, expectedVersion: 9, payload: {} })

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
})
