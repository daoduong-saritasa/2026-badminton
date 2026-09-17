import type { TournamentSnapshot } from './types'

export const impactBlockCodes = [
  'knockouts-started',
  'final-started',
  'too-few-active-pairs',
  'invalid-match-state',
  'tournament-completed',
  'decider-started',
  'placement-started',
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
 * carries `Tournament.resultRevision`, not `Tournament.version`: a caller
 * confirming the mutation passes it back as `previewTournamentVersion`, and the
 * server rejects a proposal whose projection has since been invalidated. It
 * deliberately does not move for a point scored on a live match, which would
 * otherwise reject every correction made while play is under way.
 */
export interface MutationImpact {
  resetGeneration: number
  tournamentVersion: number
  blockedReason: ImpactBlockCode | null
  before: TournamentSnapshot
  after: TournamentSnapshot | null
}
