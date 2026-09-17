import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSupabaseClient } = vi.hoisted(() => ({ getSupabaseClient: vi.fn() }))

vi.mock('../lib/supabase', () => ({ getSupabaseClient }))

import { previewResultCorrection } from './impacts'
import { InvalidTournamentDataError } from './tournament'

const tournamentId = '00000000-0000-4000-8000-000000000010'
const teamId = '00000000-0000-4000-8000-000000000013'
const matchId = '00000000-0000-4000-8000-000000000015'

const proposal = {
  matchId,
  matchVersion: 6,
  winnerSide: 'a' as const,
  games: [{ a: 15, b: 10 }, { a: 15, b: 12 }],
}

function snapshot(version: number) {
  return {
    tournament: {
      id: tournamentId,
      name: 'Tournament',
      stage: 'groups',
      setup_locked_at: '2026-09-09T00:00:00Z',
      version,
      result_revision: version,
    },
    teams: [{ id: teamId, name: 'Team', group_code: 'A' }],
    players: [],
    fixtures: [],
    matches: [],
    games: [],
    lineups: [],
  }
}

function impact(overrides: Record<string, unknown> = {}) {
  return {
    requestId: '00000000-0000-4000-8000-000000000020',
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

  it('requests a correction preview with the observed generation and match version', async () => {
    rpc.mockResolvedValue({ data: impact(), error: null })

    const result = await previewResultCorrection(proposal, 3)

    expect(rpc).toHaveBeenCalledWith('preview_result_correction', {
      p_request_id: expect.any(String),
      p_reset_generation: 3,
      p_expected_version: 6,
      p_payload: { matchId, winnerSide: 'a', games: [{ a: 15, b: 10 }, { a: 15, b: 12 }] },
    })
    expect(result.resetGeneration).toBe(3)
    expect(result.blockedReason).toBeNull()
    expect(result.after?.tournament.version).toBe(4)
    expect(result.before.teams[0]?.group).toBe('A')
  })

  it('keeps a blocked impact readable and without a projected result', async () => {
    rpc.mockResolvedValue({
      data: impact({ blockedReason: 'placement-started', after: null }),
      error: null,
    })

    const result = await previewResultCorrection(proposal, 0)

    expect(result.blockedReason).toBe('placement-started')
    expect(result.after).toBeNull()
  })

  it('rejects a block code it does not understand', async () => {
    rpc.mockResolvedValue({
      data: impact({ blockedReason: 'knockouts-started', after: null }),
      error: null,
    })

    await expect(previewResultCorrection(proposal, 0)).rejects.toBeInstanceOf(InvalidTournamentDataError)
  })

  it('rejects an unblocked impact with no projected result', async () => {
    rpc.mockResolvedValue({ data: impact({ after: null }), error: null })

    await expect(previewResultCorrection(proposal, 0)).rejects.toBeInstanceOf(InvalidTournamentDataError)
  })

  it('rejects a blocked impact that still carries a projected result', async () => {
    rpc.mockResolvedValue({
      data: impact({ blockedReason: 'decider-started' }),
      error: null,
    })

    await expect(previewResultCorrection(proposal, 0)).rejects.toBeInstanceOf(InvalidTournamentDataError)
  })

  it('rejects a malformed snapshot inside an impact', async () => {
    rpc.mockResolvedValue({
      data: impact({ after: { ...snapshot(4), teams: [{ id: teamId }] } }),
      error: null,
    })

    await expect(previewResultCorrection(proposal, 0)).rejects.toBeInstanceOf(InvalidTournamentDataError)
  })

  it('propagates a transport error unchanged', async () => {
    const error = new Error('network down')
    rpc.mockResolvedValue({ data: null, error })

    await expect(previewResultCorrection(proposal, 0)).rejects.toBe(error)
  })
})
