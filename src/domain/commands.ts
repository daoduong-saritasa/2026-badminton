import type {
  CourtAssignment,
  LineupPair,
  RosterInput,
  Score,
  Side,
  UUID,
} from './types'

export interface CommandPayloads {
  save_roster: RosterInput
  save_lineup: {
    fixtureId: UUID
    teamId: UUID
    pairs: [LineupPair, LineupPair, LineupPair, LineupPair]
  }
  confirm_lineup: { fixtureId: UUID; teamId: UUID }
  reopen_lineups: { fixtureId: UUID }
  start_qualifying: Record<string, never>
  assign_courts: { assignments: CourtAssignment[] }
  start_match: { matchId: UUID }
  take_over: { matchId: UUID }
  add_point: { matchId: UUID; side: Side }
  undo_point: { matchId: UUID }
  confirm_game: { matchId: UUID }
  mark_walkover: { matchId: UUID; winnerSide: Side }
  /** Replaces one side's players in an unstarted match; expects the match version. */
  substitute_players: { matchId: UUID; side: Side } & LineupPair
  record_draw:
    | { matchups: Array<{ fixtureId: UUID; teamAId: UUID; teamBId: UUID }> }
    | { advancingTeamIds: UUID[] }
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
