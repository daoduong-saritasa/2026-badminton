import { isPlacementStage } from './team-fixtures'
import type { Side, TournamentSnapshot, UUID } from './types'

/** The codes `private.team_correction_block_code()` can return. */
export const impactBlockCodes = [
  'invalid-match-state',
  'tournament-completed',
  'playoff-started',
  'placement-started',
] as const

export type ImpactBlockCode = (typeof impactBlockCodes)[number]

export function isImpactBlockCode(value: unknown): value is ImpactBlockCode {
  return impactBlockCodes.includes(value as ImpactBlockCode)
}

/**
 * The authoritative projection of a proposed result correction.
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

export interface ClearedPair {
  matchId: UUID
  side: Side
}

/** What an applied correction would undo beyond the match results themselves. */
export interface ImpactConsequences {
  /** The organizer must confirm the finalists again. */
  finalistConfirmationRevoked: boolean
  /** Saved placement pairs the correction clears; staff assign them again. */
  clearedPlacementPairs: ClearedPair[]
}

/**
 * Reads the consequences off the server's projection rather than recomputing
 * them, so they cannot disagree with the change the mutation would apply.
 * Null when the correction is blocked and there is no projection to read.
 */
export function impactConsequences(impact: MutationImpact): ImpactConsequences | null {
  const { before, after } = impact
  if (after === null) {
    return null
  }

  const placementFixtureIds = new Set(
    before.fixtures
      .filter((fixture) => isPlacementStage(fixture.stage))
      .map((fixture) => fixture.id),
  )
  const clearedPlacementPairs = before.matches
    .filter((match) => placementFixtureIds.has(match.fixtureId))
    .flatMap((match) => {
      const projected = after.matches.find((candidate) => candidate.id === match.id)
      return (['a', 'b'] as const)
        .filter((side) => {
          const key = side === 'a' ? 'pairA' : 'pairB'
          return match[key] !== null && (projected?.[key] ?? null) === null
        })
        .map((side) => ({ matchId: match.id, side }))
    })

  return {
    finalistConfirmationRevoked:
      before.tournament.finalistsConfirmedAt !== null &&
      after.tournament.finalistsConfirmedAt === null,
    clearedPlacementPairs,
  }
}
