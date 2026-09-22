import type {
  CourtAssignment,
  Pair,
  RosterInput,
  Score,
  Side,
  UUID,
} from './types'

export interface CommandPayloads {
  save_roster: RosterInput
  start_qualifying: Record<string, never>
  assign_courts: { assignments: CourtAssignment[] }
  /**
   * Saves one side's pair on an unstarted match; expects the match version.
   * Only an organizer may set `ruleException`, which waives the seed and
   * qualifying-reuse rules but never the duplicate or playing-player guards.
   */
  assign_pair: { matchId: UUID; side: Side; ruleException: boolean } & Pair
  start_match: { matchId: UUID }
  take_over: { matchId: UUID }
  add_point: { matchId: UUID; side: Side }
  undo_point: { matchId: UUID }
  confirm_game: { matchId: UUID }
  mark_walkover: { matchId: UUID; winnerSide: Side }
  /** Sets the two matchups of a four-team playoff round. */
  record_draw: { matchups: Array<{ fixtureId: UUID; teamAId: UUID; teamBId: UUID }> }
  confirm_finalists: Record<string, never>
  correct_result: {
    matchId: UUID
    winnerSide: Side
    games: Score[]
    previewTournamentVersion: number
  }
}

export type MutationInput<K extends keyof CommandPayloads> = {
  requestId: UUID
  resetGeneration: number
  expectedVersion: number
  payload: CommandPayloads[K]
}

export interface MutationReceipt {
  requestId: UUID
  resetGeneration: number
  tournamentVersion: number
  matchId: UUID | null
  matchVersion: number | null
}
