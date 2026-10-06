export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
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
        Relationships: [
          {
            foreignKeyName: "match_games_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
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
          result_kind: string | null
          state: string
          updated_at: string
          version: number
          winner_side: string | null
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
          result_kind?: string | null
          state?: string
          updated_at?: string
          version?: number
          winner_side?: string | null
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
          result_kind?: string | null
          state?: string
          updated_at?: string
          version?: number
          winner_side?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matches_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "team_fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_pair_a_seed1_player_id_fkey"
            columns: ["pair_a_player_1_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_pair_a_seed2_player_id_fkey"
            columns: ["pair_a_player_2_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_pair_b_seed1_player_id_fkey"
            columns: ["pair_b_player_1_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_pair_b_seed2_player_id_fkey"
            columns: ["pair_b_player_2_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          created_at: string
          id: string
          name: string
          seed: number
          team_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          seed: number
          team_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          seed?: number
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "players_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      qualification_playoff_rounds: {
        Row: {
          available_places: number
          created_at: string
          fixed_finalist_ids: string[]
          id: string
          round_number: number
          team_ids: string[]
          tournament_id: string
        }
        Insert: {
          available_places: number
          created_at?: string
          fixed_finalist_ids?: string[]
          id?: string
          round_number: number
          team_ids: string[]
          tournament_id: string
        }
        Update: {
          available_places?: number
          created_at?: string
          fixed_finalist_ids?: string[]
          id?: string
          round_number?: number
          team_ids?: string[]
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qualification_playoff_rounds_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournament"
            referencedColumns: ["id"]
          },
        ]
      }
      team_fixtures: {
        Row: {
          created_at: string
          id: string
          playoff_round_id: string | null
          stage: string
          team_a_id: string | null
          team_b_id: string | null
          tournament_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          playoff_round_id?: string | null
          stage: string
          team_a_id?: string | null
          team_b_id?: string | null
          tournament_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          playoff_round_id?: string | null
          stage?: string
          team_a_id?: string | null
          team_b_id?: string | null
          tournament_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "team_fixtures_playoff_round_id_fkey"
            columns: ["playoff_round_id"]
            isOneToOne: false
            referencedRelation: "qualification_playoff_rounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_fixtures_team_a_id_fkey"
            columns: ["team_a_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_fixtures_team_b_id_fkey"
            columns: ["team_b_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_fixtures_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournament"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "teams_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournament"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament: {
        Row: {
          created_at: string
          current_playoff_round_id: string | null
          finalists_confirmed_at: string | null
          id: string
          name: string
          result_revision: number
          setup_locked_at: string | null
          singleton: boolean
          stage: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          current_playoff_round_id?: string | null
          finalists_confirmed_at?: string | null
          id?: string
          name: string
          result_revision?: number
          setup_locked_at?: string | null
          singleton?: boolean
          stage?: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          current_playoff_round_id?: string | null
          finalists_confirmed_at?: string | null
          id?: string
          name?: string
          result_revision?: number
          setup_locked_at?: string | null
          singleton?: boolean
          stage?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "tournament_current_playoff_round_id_fkey"
            columns: ["current_playoff_round_id"]
            isOneToOne: false
            referencedRelation: "qualification_playoff_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_generation: {
        Row: {
          reset_generation: number
          singleton: boolean
        }
        Insert: {
          reset_generation: number
          singleton?: boolean
        }
        Update: {
          reset_generation?: number
          singleton?: boolean
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_point: {
        Args: {
          p_expected_version: number
          p_payload: Json
          p_request_id: string
          p_reset_generation: number
        }
        Returns: Json
      }
      assign_courts: {
        Args: {
          p_expected_version: number
          p_payload: Json
          p_request_id: string
          p_reset_generation: number
        }
        Returns: Json
      }
      assign_pair: {
        Args: {
          p_expected_version: number
          p_payload: Json
          p_request_id: string
          p_reset_generation: number
        }
        Returns: Json
      }
      confirm_finalists: {
        Args: {
          p_expected_version: number
          p_payload: Json
          p_request_id: string
          p_reset_generation: number
        }
        Returns: Json
      }
      confirm_game: {
        Args: {
          p_expected_version: number
          p_payload: Json
          p_request_id: string
          p_reset_generation: number
        }
        Returns: Json
      }
      correct_result: {
        Args: {
          p_expected_version: number
          p_payload: Json
          p_request_id: string
          p_reset_generation: number
        }
        Returns: Json
      }
      exchange_staff_pin: {
        Args: {
          p_bucket: string
          p_pin: string
          p_session_id: string
          p_user_id: string
        }
        Returns: Json
      }
      get_score_access: { Args: { p_match_id: string }; Returns: boolean }
      get_staff_access: { Args: never; Returns: Json }
      get_tournament_snapshot: { Args: never; Returns: Json }
      mark_walkover: {
        Args: {
          p_expected_version: number
          p_payload: Json
          p_request_id: string
          p_reset_generation: number
        }
        Returns: Json
      }
      preview_result_correction: {
        Args: {
          p_expected_version: number
          p_payload: Json
          p_request_id: string
          p_reset_generation: number
        }
        Returns: Json
      }
      record_draw: {
        Args: {
          p_expected_version: number
          p_payload: Json
          p_request_id: string
          p_reset_generation: number
        }
        Returns: Json
      }
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
      revoke_staff_access: { Args: never; Returns: undefined }
      rotate_staff_pin_for_session: {
        Args: {
          p_pin: string
          p_role: string
          p_session_id: string
          p_user_id: string
        }
        Returns: Json
      }
      save_roster: {
        Args: {
          p_expected_version: number
          p_payload: Json
          p_request_id: string
          p_reset_generation: number
        }
        Returns: Json
      }
      set_reset_enabled: { Args: { p_enabled: boolean }; Returns: undefined }
      start_group_play: {
        Args: {
          p_expected_version: number
          p_payload: Json
          p_request_id: string
          p_reset_generation: number
        }
        Returns: Json
      }
      start_match: {
        Args: {
          p_expected_version: number
          p_payload: Json
          p_request_id: string
          p_reset_generation: number
        }
        Returns: Json
      }
      start_qualifying: {
        Args: {
          p_expected_version: number
          p_payload: Json
          p_request_id: string
          p_reset_generation: number
        }
        Returns: Json
      }
      take_over: {
        Args: {
          p_expected_version: number
          p_payload: Json
          p_request_id: string
          p_reset_generation: number
        }
        Returns: Json
      }
      undo_point: {
        Args: {
          p_expected_version: number
          p_payload: Json
          p_request_id: string
          p_reset_generation: number
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

