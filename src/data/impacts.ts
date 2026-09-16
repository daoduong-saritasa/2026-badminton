import { z } from 'zod'

import { impactBlockCodes } from '../domain/impacts'
import type { ImpactBlockCode, MutationImpact } from '../domain/impacts'
import type { Score, UUID } from '../domain/types'
import { getSupabaseClient } from '../lib/supabase'
import { InvalidTournamentDataError, parseSnapshot } from './tournament'

const impactEnvelopeSchema = z.object({
  resetGeneration: z.int().nonnegative(),
  tournamentVersion: z.int().nonnegative(),
  blockedReason: z.enum(impactBlockCodes).nullable(),
  before: z.unknown(),
  after: z.unknown(),
})

/**
 * A preview the client cannot fully understand must not be confirmable, so an
 * unknown block code, a missing `before`, or a blocked impact that still
 * carries an `after` is rejected rather than shown with the unreadable parts
 * dropped.
 */
function mapImpact(value: unknown, label: string): MutationImpact {
  const parsed = impactEnvelopeSchema.safeParse(value)
  if (!parsed.success) {
    console.error(`${label} validation failed`, { issues: parsed.error.issues })
    throw new InvalidTournamentDataError(`The server returned an invalid ${label}`, parsed.error.issues)
  }

  const { resetGeneration, tournamentVersion, blockedReason, before, after } = parsed.data
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
  matchId: UUID,
  score: Score,
  resetGeneration: number,
): Promise<MutationImpact> {
  const { data, error } = await getSupabaseClient().rpc('preview_result_correction', {
    p_match_id: matchId,
    p_score: { a: score.a, b: score.b },
    p_reset_generation: resetGeneration,
  })
  if (error) throw error
  return mapImpact(data, 'result correction preview')
}

export async function previewWithdrawal(
  pairId: UUID,
  resetGeneration: number,
): Promise<MutationImpact> {
  const { data, error } = await getSupabaseClient().rpc('preview_withdrawal', {
    p_pair_id: pairId,
    p_reset_generation: resetGeneration,
  })
  if (error) throw error
  return mapImpact(data, 'withdrawal preview')
}
