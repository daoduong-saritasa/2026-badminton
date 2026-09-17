import { z } from 'zod'

import { impactBlockCodes } from '../domain/impacts'
import type { ImpactBlockCode, MutationImpact } from '../domain/impacts'
import type { Score, Side, UUID } from '../domain/types'
import { getSupabaseClient } from '../lib/supabase'
import { InvalidTournamentDataError, parseSnapshot } from './tournament'

/**
 * The preview RPC does not echo the reset generation; the one the request was
 * checked against is the one the projection describes.
 */
const impactEnvelopeSchema = z.object({
  tournamentVersion: z.int().nonnegative(),
  blockedReason: z.enum(impactBlockCodes).nullable(),
  before: z.unknown(),
  after: z.unknown(),
})

export interface ResultCorrectionProposal {
  matchId: UUID
  matchVersion: number
  winnerSide: Side
  games: Score[]
}

/**
 * A preview the client cannot fully understand must not be confirmable, so an
 * unknown block code, a missing `before`, or a blocked impact that still
 * carries an `after` is rejected rather than shown with the unreadable parts
 * dropped.
 */
function mapImpact(value: unknown, resetGeneration: number, label: string): MutationImpact {
  const parsed = impactEnvelopeSchema.safeParse(value)
  if (!parsed.success) {
    console.error(`${label} validation failed`, { issues: parsed.error.issues })
    throw new InvalidTournamentDataError(`The server returned an invalid ${label}`, parsed.error.issues)
  }

  const { tournamentVersion, blockedReason, before, after } = parsed.data
  const blocked: ImpactBlockCode | null = blockedReason

  if (blocked === null && (after === null || after === undefined)) {
    throw new InvalidTournamentDataError(`The server returned an unblocked ${label} with no projected result`)
  }
  if (blocked !== null && after !== null && after !== undefined) {
    throw new InvalidTournamentDataError(`The server returned a blocked ${label} with a projected result`)
  }

  return {
    resetGeneration,
    tournamentVersion,
    blockedReason: blocked,
    before: parseSnapshot(before),
    after: blocked === null ? parseSnapshot(after) : null,
  }
}

export async function previewResultCorrection(
  proposal: ResultCorrectionProposal,
  resetGeneration: number,
): Promise<MutationImpact> {
  const { data, error } = await getSupabaseClient().rpc('preview_result_correction', {
    p_request_id: crypto.randomUUID(),
    p_reset_generation: resetGeneration,
    p_expected_version: proposal.matchVersion,
    p_payload: {
      matchId: proposal.matchId,
      winnerSide: proposal.winnerSide,
      games: proposal.games.map((game) => ({ a: game.a, b: game.b })),
    },
  })
  if (error) throw error
  return mapImpact(data, resetGeneration, 'result correction preview')
}
