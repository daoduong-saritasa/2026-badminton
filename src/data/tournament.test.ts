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
    rpc.mockResolvedValueOnce({ data: snapshot(1), error: null })
    await expect(fetchTournament()).resolves.toMatchObject({
      tournament: { id: tournamentId, setupLockedAt: '2026-09-09T00:00:00Z', version: 1 },
      pairs: [{ id: pairId, playerAId, playerBId, group: 'A' }],
    })

    rpc.mockResolvedValueOnce({ data: snapshot(0), error: null })
    await expect(fetchTournament()).rejects.toBeInstanceOf(StaleTournamentSnapshotError)
  })

  it('refetches through the acknowledged version before resolving a mutation', async () => {
    rpc
      .mockResolvedValueOnce({
        data: {
          requestId,
          tournamentVersion: 2,
          matchId: null,
          matchVersion: null,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: snapshot(2), error: null })

    await expect(
      mutateTournament('generate_fixtures', {
        requestId,
        expectedVersion: 1,
        payload: {},
      }),
    ).resolves.toMatchObject({ requestId, tournamentVersion: 2 })
    expect(rpc).toHaveBeenNthCalledWith(1, 'generate_fixtures', {
      p_request_id: requestId,
      p_expected_version: 1,
      p_payload: {},
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'get_tournament_snapshot')
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
    rpc.mockResolvedValueOnce({ data: snapshot(3), error: null })
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
})
