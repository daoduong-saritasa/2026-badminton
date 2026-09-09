import type {
  CourtAssignment,
  Group,
  Score,
  SetupInput,
  Side,
  UUID,
} from './types'

export interface CommandPayloads {
  save_setup: { setup: SetupInput }
  generate_fixtures: Record<string, never>
  assign_courts: { assignments: CourtAssignment[] }
  start_scoring: { matchId: UUID }
  take_over: { matchId: UUID }
  add_point: { matchId: UUID; side: Side }
  undo_point: { matchId: UUID }
  confirm_result: { matchId: UUID }
  enter_result: { matchId: UUID; score: Score }
  correct_result: { matchId: UUID; score: Score }
  mark_walkover: { matchId: UUID; winnerId: UUID }
  withdraw_pair: { pairId: UUID }
  resolve_tie: {
    group: Group
    orderedPairIds: UUID[]
    explanation: string
  }
  confirm_groups: Record<string, never>
  reopen_tournament: Record<string, never>
}

export type MutationInput<K extends keyof CommandPayloads> = {
  requestId: UUID
  expectedVersion: number
  payload: CommandPayloads[K]
}

export interface MutationReceipt {
  requestId: UUID
  tournamentVersion: number
  matchId: UUID | null
  matchVersion: number | null
}
