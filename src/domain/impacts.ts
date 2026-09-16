import type { TournamentSnapshot } from './types'

export const impactBlockCodes = [
  'knockouts-started',
  'final-started',
  'too-few-active-pairs',
  'invalid-match-state',
  'tournament-completed',
] as const

export type ImpactBlockCode = (typeof impactBlockCodes)[number]

export function isImpactBlockCode(value: unknown): value is ImpactBlockCode {
  return impactBlockCodes.includes(value as ImpactBlockCode)
}

/**
 * The authoritative projection of a proposed correction or withdrawal.
 *
 * `after` is the snapshot the tournament would hold if the mutation were
 * applied, and is null exactly when `blockedReason` is set. `tournamentVersion`
 * is the version the projection read; a caller confirming the mutation passes
 * it back as `previewTournamentVersion` so the server can reject a proposal
 * built on a snapshot that has since moved.
 */
export interface MutationImpact {
  resetGeneration: number
  tournamentVersion: number
  blockedReason: ImpactBlockCode | null
  before: TournamentSnapshot
  after: TournamentSnapshot | null
}
