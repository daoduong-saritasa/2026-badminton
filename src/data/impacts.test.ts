import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSupabaseClient } = vi.hoisted(() => ({ getSupabaseClient: vi.fn() }))

vi.mock('../lib/supabase', () => ({ getSupabaseClient }))

import { previewResultCorrection, previewWithdrawal } from './impacts'
import { InvalidTournamentDataError } from './tournament'

const tournamentId = '00000000-0000-4000-8000-000000000010'
const playerAId = '00000000-0000-4000-8000-000000000011'
const playerBId = '00000000-0000-4000-8000-000000000012'
const pairId = '00000000-0000-4000-8000-000000000013'
const matchId = '00000000-0000-4000-8000-000000000015'

function snapshot(version: number) {
  return {
    tournament: {
      id: tournamentId,
      name: 'Tournament',
      stage: 'groups',
      setup_locked_at: '2026-09-09T00:00:00Z',
      court_count: 2,
      version,
      result_revision: version,
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

function impact(overrides: Record<string, unknown> = {}) {
  return {
    resetGeneration: 0,
    tournamentVersion: 4,
    blockedReason: null,
    before: snapshot(4),
    after: snapshot(4),
    ...overrides,
  }
}

describe('impact previews', () => {
  const rpc = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    getSupabaseClient.mockReturnValue({ rpc })
  })

  it('requests a correction preview with the observed generation', async () => {
    rpc.mockResolvedValue({ data: impact(), error: null })

    const result = await previewResultCorrection(matchId, { a: 21, b: 15 }, 3)

    expect(rpc).toHaveBeenCalledWith('preview_result_correction', {
      p_match_id: matchId,
      p_score: { a: 21, b: 15 },
      p_reset_generation: 3,
    })
    expect(result.blockedReason).toBeNull()
    expect(result.after?.tournament.version).toBe(4)
    expect(result.before.pairs[0].group).toBe('A')
  })

  it('requests a withdrawal preview with the observed generation', async () => {
    rpc.mockResolvedValue({ data: impact(), error: null })

    await previewWithdrawal(pairId, 7)

    expect(rpc).toHaveBeenCalledWith('preview_withdrawal', {
      p_pair_id: pairId,
      p_reset_generation: 7,
    })
  })

  it('keeps a blocked impact readable and without a projected result', async () => {
    rpc.mockResolvedValue({
      data: impact({ blockedReason: 'too-few-active-pairs', after: null }),
      error: null,
    })

    const result = await previewWithdrawal(pairId, 0)

    expect(result.blockedReason).toBe('too-few-active-pairs')
    expect(result.after).toBeNull()
  })

  it('rejects a block code it does not understand', async () => {
    rpc.mockResolvedValue({
      data: impact({ blockedReason: 'court-on-fire', after: null }),
      error: null,
    })

    await expect(previewWithdrawal(pairId, 0)).rejects.toBeInstanceOf(InvalidTournamentDataError)
  })

  it('rejects an unblocked impact with no projected result', async () => {
    rpc.mockResolvedValue({ data: impact({ after: null }), error: null })

    await expect(previewResultCorrection(matchId, { a: 21, b: 15 }, 0)).rejects.toBeInstanceOf(
      InvalidTournamentDataError,
    )
  })

  it('rejects a blocked impact that still carries a projected result', async () => {
    rpc.mockResolvedValue({
      data: impact({ blockedReason: 'knockouts-started' }),
      error: null,
    })

    await expect(previewResultCorrection(matchId, { a: 21, b: 15 }, 0)).rejects.toBeInstanceOf(
      InvalidTournamentDataError,
    )
  })

  it('rejects a malformed snapshot inside an impact', async () => {
    rpc.mockResolvedValue({
      data: impact({ after: { ...snapshot(4), pairs: [{ id: pairId }] } }),
      error: null,
    })

    await expect(previewResultCorrection(matchId, { a: 21, b: 15 }, 0)).rejects.toBeInstanceOf(
      InvalidTournamentDataError,
    )
  })

  it('propagates a transport error unchanged', async () => {
    const error = new Error('network down')
    rpc.mockResolvedValue({ data: null, error })

    await expect(previewWithdrawal(pairId, 0)).rejects.toBe(error)
  })
})
