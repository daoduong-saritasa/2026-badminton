// Schema-derived fallback generated while the local Supabase container is unavailable.
// Regenerate from the running local schema before clearing the Phase 2 verification debt.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

type TournamentStage = 'setup' | 'groups' | 'knockouts' | 'completed'
type MatchRound = 'group' | 'semifinal' | 'final'
type MatchState = 'unstarted' | 'playing' | 'completed' | 'void'
type ResultKind = 'played' | 'walkover'

type MutationFunction = {
  Args: {
    p_expected_version: number
    p_payload: Json
    p_request_id: string
  }
  Returns: Json
}

export type Database = {
  public: {
    Tables: {
      tournament: {
        Row: {
          created_at: string
          id: string
          name: string
          setup_locked_at: string | null
          singleton: boolean
          stage: TournamentStage
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          setup_locked_at?: string | null
          singleton?: boolean
          stage?: TournamentStage
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          setup_locked_at?: string | null
          singleton?: boolean
          stage?: TournamentStage
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      players: {
        Row: { created_at: string; id: string; name: string; seed: number }
        Insert: { created_at?: string; id?: string; name: string; seed: number }
        Update: { created_at?: string; id?: string; name?: string; seed?: number }
        Relationships: []
      }
      pairs: {
        Row: {
          created_at: string
          group_code: string
          id: string
          player_a_id: string
          player_b_id: string
          team_name: string | null
          withdrawn: boolean
        }
        Insert: {
          created_at?: string
          group_code: string
          id?: string
          player_a_id: string
          player_b_id: string
          team_name?: string | null
          withdrawn?: boolean
        }
        Update: {
          created_at?: string
          group_code?: string
          id?: string
          player_a_id?: string
          player_b_id?: string
          team_name?: string | null
          withdrawn?: boolean
        }
        Relationships: []
      }
      matches: {
        Row: {
          court: number | null
          created_at: string
          group_code: string | null
          id: string
          pair_a_id: string | null
          pair_b_id: string | null
          playing_order: number
          result_kind: ResultKind | null
          round: MatchRound
          score_a: number | null
          score_b: number | null
          source_a_label: string | null
          source_a_match_id: string | null
          source_b_label: string | null
          source_b_match_id: string | null
          state: MatchState
          tournament_id: string
          updated_at: string
          version: number
          winner_id: string | null
        }
        Insert: {
          court?: number | null
          created_at?: string
          group_code?: string | null
          id?: string
          pair_a_id?: string | null
          pair_b_id?: string | null
          playing_order: number
          result_kind?: ResultKind | null
          round: MatchRound
          score_a?: number | null
          score_b?: number | null
          source_a_label?: string | null
          source_a_match_id?: string | null
          source_b_label?: string | null
          source_b_match_id?: string | null
          state?: MatchState
          tournament_id: string
          updated_at?: string
          version?: number
          winner_id?: string | null
        }
        Update: {
          court?: number | null
          created_at?: string
          group_code?: string | null
          id?: string
          pair_a_id?: string | null
          pair_b_id?: string | null
          playing_order?: number
          result_kind?: ResultKind | null
          round?: MatchRound
          score_a?: number | null
          score_b?: number | null
          source_a_label?: string | null
          source_a_match_id?: string | null
          source_b_label?: string | null
          source_b_match_id?: string | null
          state?: MatchState
          tournament_id?: string
          updated_at?: string
          version?: number
          winner_id?: string | null
        }
        Relationships: []
      }
      tie_resolutions: {
        Row: {
          created_at: string
          explanation: string
          group_code: string
          ordered_pair_ids: string[]
          standings_revision: number
          tournament_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          explanation: string
          group_code: string
          ordered_pair_ids: string[]
          standings_revision: number
          tournament_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          explanation?: string
          group_code?: string
          ordered_pair_ids?: string[]
          standings_revision?: number
          tournament_id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<never, never>
    Functions: {
      add_point: MutationFunction
      assign_courts: MutationFunction
      confirm_groups: MutationFunction
      confirm_result: MutationFunction
      correct_result: MutationFunction
      enter_result: MutationFunction
      exchange_staff_pin: {
        Args: { p_bucket: string; p_pin: string; p_session_id: string; p_user_id: string }
        Returns: Json
      }
      generate_fixtures: MutationFunction
      get_score_access: { Args: { p_match_id: string }; Returns: boolean }
      get_staff_access: { Args: Record<PropertyKey, never>; Returns: Json }
      get_tournament_snapshot: { Args: Record<PropertyKey, never>; Returns: Json }
      mark_walkover: MutationFunction
      reopen_tournament: MutationFunction
      resolve_tie: MutationFunction
      revoke_staff_access: { Args: Record<PropertyKey, never>; Returns: undefined }
      rotate_staff_pin_for_session: {
        Args: { p_pin: string; p_session_id: string; p_user_id: string }
        Returns: Json
      }
      save_setup: MutationFunction
      start_scoring: MutationFunction
      take_over: MutationFunction
      undo_point: MutationFunction
      withdraw_pair: MutationFunction
    }
    Enums: Record<never, never>
    CompositeTypes: Record<never, never>
  }
}

type PublicSchema = Database['public']

export type Tables<TableName extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][TableName]['Row']

export type TablesInsert<TableName extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][TableName]['Insert']

export type TablesUpdate<TableName extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][TableName]['Update']
