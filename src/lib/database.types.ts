// Schema-derived fallback maintained while the local Supabase container is unavailable.
// Regenerate from the running local schema before clearing the verification debt.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

type TournamentStage = 'setup' | 'groups' | 'knockouts' | 'completed'
type FixtureStage = 'qualifying' | 'qualification-playoff' | 'third-place' | 'final'
type MatchState = 'unstarted' | 'playing' | 'completed' | 'unnecessary'
type ResultKind = 'played' | 'walkover'
type Side = 'a' | 'b'

type MutationFunction = {
  Args: {
    p_expected_version: number
    p_payload: Json
    p_request_id: string
    p_reset_generation: number
  }
  Returns: Json
}

export type Database = {
  public: {
    Tables: {
      tournament: {
        Row: {
          created_at: string
          finalists_confirmed_at: string | null
          id: string
          name: string
          qualification_draw_winner_ids: string[] | null
          result_revision: number
          setup_locked_at: string | null
          singleton: boolean
          stage: TournamentStage
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          finalists_confirmed_at?: string | null
          id?: string
          name: string
          qualification_draw_winner_ids?: string[] | null
          result_revision?: number
          setup_locked_at?: string | null
          singleton?: boolean
          stage?: TournamentStage
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          finalists_confirmed_at?: string | null
          id?: string
          name?: string
          qualification_draw_winner_ids?: string[] | null
          result_revision?: number
          setup_locked_at?: string | null
          singleton?: boolean
          stage?: TournamentStage
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      tournament_generation: {
        Row: { reset_generation: number; singleton: boolean }
        Insert: { reset_generation: number; singleton?: boolean }
        Update: { reset_generation?: number; singleton?: boolean }
        Relationships: []
      }
      teams: {
        Row: {
          created_at: string
          id: string
          name: string
          tournament_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          tournament_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          tournament_id?: string
        }
        Relationships: []
      }
      players: {
        Row: { created_at: string; id: string; name: string; seed: number; team_id: string }
        Insert: { created_at?: string; id?: string; name: string; seed: number; team_id: string }
        Update: { created_at?: string; id?: string; name?: string; seed?: number; team_id?: string }
        Relationships: []
      }
      team_fixtures: {
        Row: {
          created_at: string
          id: string
          stage: FixtureStage
          team_a_id: string | null
          team_b_id: string | null
          tournament_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          stage: FixtureStage
          team_a_id?: string | null
          team_b_id?: string | null
          tournament_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          stage?: FixtureStage
          team_a_id?: string | null
          team_b_id?: string | null
          tournament_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      matches: {
        Row: {
          court: number | null
          created_at: string
          fixture_id: string
          id: string
          match_number: number
          pair_a_player_1_id: string | null
          pair_a_player_2_id: string | null
          pair_b_player_1_id: string | null
          pair_b_player_2_id: string | null
          result_kind: ResultKind | null
          state: MatchState
          updated_at: string
          version: number
          winner_side: Side | null
        }
        Insert: {
          court?: number | null
          created_at?: string
          fixture_id: string
          id?: string
          match_number: number
          pair_a_player_1_id?: string | null
          pair_a_player_2_id?: string | null
          pair_b_player_1_id?: string | null
          pair_b_player_2_id?: string | null
          result_kind?: ResultKind | null
          state?: MatchState
          updated_at?: string
          version?: number
          winner_side?: Side | null
        }
        Update: {
          court?: number | null
          created_at?: string
          fixture_id?: string
          id?: string
          match_number?: number
          pair_a_player_1_id?: string | null
          pair_a_player_2_id?: string | null
          pair_b_player_1_id?: string | null
          pair_b_player_2_id?: string | null
          result_kind?: ResultKind | null
          state?: MatchState
          updated_at?: string
          version?: number
          winner_side?: Side | null
        }
        Relationships: []
      }
      match_games: {
        Row: {
          confirmed_at: string | null
          created_at: string
          game_number: number
          id: string
          match_id: string
          score_a: number
          score_b: number
          updated_at: string
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string
          game_number: number
          id?: string
          match_id: string
          score_a?: number
          score_b?: number
          updated_at?: string
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string
          game_number?: number
          id?: string
          match_id?: string
          score_a?: number
          score_b?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<never, never>
    Functions: {
      add_point: MutationFunction
      assign_courts: MutationFunction
      confirm_game: MutationFunction
      confirm_finalists: MutationFunction
      confirm_lineup: MutationFunction
      correct_result: MutationFunction
      exchange_staff_pin: {
        Args: { p_bucket: string; p_pin: string; p_session_id: string; p_user_id: string }
        Returns: Json
      }
      get_score_access: { Args: { p_match_id: string }; Returns: boolean }
      get_staff_access: {
        Args: Record<PropertyKey, never>
        Returns: {
          expiresAt: string
          role: 'organizer' | 'referee'
          sessionId: string
        } | null
      }
      get_tournament_snapshot: { Args: Record<PropertyKey, never>; Returns: Json }
      mark_walkover: MutationFunction
      preview_result_correction: MutationFunction
      record_draw: MutationFunction
      reopen_lineups: MutationFunction
      revoke_staff_access: { Args: Record<PropertyKey, never>; Returns: undefined }
      rotate_staff_pin_for_session: {
        Args: {
          p_pin: string
          p_role: 'organizer' | 'referee'
          p_session_id: string
          p_user_id: string
        }
        Returns: Json
      }
      save_lineup: MutationFunction
      save_roster: MutationFunction
      set_reset_enabled: { Args: { p_enabled: boolean }; Returns: undefined }
      reset_tournament: {
        Args: {
          p_confirmation_name: string
          p_expected_generation: number
          p_expected_tournament_id: string
          p_expected_version: number
          p_mode: string
          p_request_id: string
        }
        Returns: Json
      }
      start_qualifying: MutationFunction
      start_group_play: MutationFunction
      start_match: MutationFunction
      substitute_players: MutationFunction
      take_over: MutationFunction
      undo_point: MutationFunction
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
