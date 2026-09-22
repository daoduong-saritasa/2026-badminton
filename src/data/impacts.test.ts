import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSupabaseClient } = vi.hoisted(() => ({ getSupabaseClient: vi.fn() }))

vi.mock('../lib/supabase', () => ({ getSupabaseClient }))

import { impactConsequences } from '../domain/impacts'
import { previewResultCorrection } from './impacts'
import { InvalidTournamentDataError } from './tournament'

const tournamentId = '00000000-0000-4000-8000-000000000010'
const teamId = '00000000-0000-4000-8000-000000000013'
const matchId = '00000000-0000-4000-8000-000000000015'
const finalId = '00000000-0000-4000-8000-000000000016'
const finalMatchId = '00000000-0000-4000-8000-000000000018'
const otherTeamId = '00000000-0000-4000-8000-000000000017'
const playerIds = [
  '00000000-0000-4000-8000-000000000021',
  '00000000-0000-4000-8000-000000000022',
  '00000000-0000-4000-8000-000000000023',
  '00000000-0000-4000-8000-000000000024',
]

const proposal = {
  matchId,
  matchVersion: 6,
  winnerSide: 'a' as const,
  games: [{ a: 21, b: 10 }],
}

/** A final whose first match has pairs saved on the given sides. */
function placementSnapshot(version: number, confirmedAt: string | null, pairedSides: Array<'a' | 'b'>) {
  const paired = (side: 'a' | 'b', index: number) => (pairedSides.includes(side) ? playerIds[index] : null)
  return {
    ...snapshot(version),
    tournament: { ...snapshot(version).tournament, finalists_confirmed_at: confirmedAt },
    fixtures: [{ id: finalId, stage: 'final', team_a_id: teamId, team_b_id: otherTeamId, playoff_round_id: null, version: 1 }],
    matches: [{
      id: finalMatchId,
      fixture_id: finalId,
      match_number: 1,
      pair_a_player_1_id: paired('a', 0),
      pair_a_player_2_id: paired('a', 1),
      pair_b_player_1_id: paired('b', 2),
      pair_b_player_2_id: paired('b', 3),
      court: null,
      state: 'unstarted',
      result_kind: null,
      winner_side: null,
      version: 1,
    }],
  }
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
      finalists_confirmed_at: null,
      current_playoff_round_id: null,
    },
    teams: [{ id: teamId, name: 'Team' }],
    players: [],
    fixtures: [],
    matches: [],
    games: [],
    playoff_rounds: [],
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
      p_payload: { matchId, winnerSide: 'a', games: [{ a: 21, b: 10 }] },
    })
    expect(result.resetGeneration).toBe(3)
    expect(result.blockedReason).toBeNull()
    expect(result.after?.tournament.version).toBe(4)
    expect(result.before.teams[0]?.name).toBe('Team')
  })

  it('accepts every block code the server can return', async () => {
    for (const code of ['invalid-match-state', 'tournament-completed', 'playoff-started', 'placement-started']) {
      rpc.mockResolvedValue({ data: impact({ blockedReason: code, after: null }), error: null })

      await expect(previewResultCorrection(proposal, 0)).resolves.toMatchObject({ blockedReason: code })
    }
  })

  it('reports a revoked finalist confirmation and cleared placement pairs by match and side', async () => {
    rpc.mockResolvedValue({
      data: impact({
        before: placementSnapshot(4, '2026-09-21T02:00:00Z', ['a', 'b']),
        after: placementSnapshot(4, null, []),
      }),
      error: null,
    })

    expect(impactConsequences(await previewResultCorrection(proposal, 0))).toEqual({
      finalistConfirmationRevoked: true,
      clearedPlacementPairs: [
        { matchId: finalMatchId, side: 'a' },
        { matchId: finalMatchId, side: 'b' },
      ],
    })
  })

  it('reports no consequences when participants are preserved, and none for a blocked impact', async () => {
    const preserved = placementSnapshot(4, '2026-09-21T02:00:00Z', ['a'])
    rpc.mockResolvedValue({ data: impact({ before: preserved, after: preserved }), error: null })

    expect(impactConsequences(await previewResultCorrection(proposal, 0))).toEqual({
      finalistConfirmationRevoked: false,
      clearedPlacementPairs: [],
    })

    rpc.mockResolvedValue({ data: impact({ blockedReason: 'placement-started', after: null }), error: null })
    expect(impactConsequences(await previewResultCorrection(proposal, 0))).toBeNull()
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
      data: impact({ blockedReason: 'decider-started', after: null }),
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
      data: impact({ blockedReason: 'playoff-started' }),
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
