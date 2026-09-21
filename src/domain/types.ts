export type UUID = string

export type Side = 'a' | 'b'
export type Seed = 1 | 2
export type Court = 1 | 2

export interface Score {
  a: number
  b: number
}

/**
 * `'groups'` is the qualifying stage. It keeps the value the database stores;
 * renaming it needs a migration.
 */
export type TournamentStage = 'setup' | 'groups' | 'knockouts' | 'completed'

export interface Tournament {
  id: UUID
  name: string
  stage: TournamentStage
  setupLockedAt: string | null
  version: number
  /**
   * Bumps for every change a preview's projection depends on, and stays still
   * while a live score moves. `version` bumps for both, so it cannot tell a
   * reviewed projection from one a scored point invalidated.
   */
  resultRevision: number
  /** Set when the organizer confirms the finalists; cleared when they change. */
  finalistsConfirmedAt: string | null
  /**
   * The teams a three-team playoff sends to the final once a supervised draw
   * settles its remaining tie: the automatic qualifiers plus the drawn teams.
   */
  qualificationDrawWinnerIds: UUID[] | null
}

export interface Player {
  id: UUID
  name: string
  seed: Seed
}

export interface Team {
  id: UUID
  name: string
}

export interface TeamPlayer extends Player {
  teamId: UUID
}

/**
 * Two teammates playing one match. Seed rules live in validation: declared
 * pairs 1–3 mix seeds, while the playoff pair and substitutions do not.
 */
export interface LineupPair {
  player1Id: UUID
  player2Id: UUID
}

export interface Lineup {
  fixtureId: UUID
  teamId: UUID
  /** Matches 1–3, then the predeclared qualification playoff pair. */
  pairs: [LineupPair, LineupPair, LineupPair, LineupPair]
  confirmedAt: string | null
}

export type FixtureStage =
  | 'qualifying'
  | 'qualification-playoff'
  | 'third-place'
  | 'final'

export interface TeamFixture {
  id: UUID
  stage: FixtureStage
  teamAId: UUID | null
  teamBId: UUID | null
  version: number
}

export type RankingCriterion =
  | 'match-wins'
  | 'tied-match-wins'
  | 'tied-point-difference'
  | 'point-difference'

export interface TeamStanding {
  teamId: UUID
  matchWins: number
  /** Walkovers count as match wins but add no points. */
  pointsScored: number
  pointsConceded: number
  pointDifference: number
  /** Competition rank; teams the criteria did not separate share one. */
  rank: number
  /**
   * The criterion that fixed this team's rank among the teams level with it on
   * match wins, or null when the criteria did not separate it.
   */
  separatedBy: RankingCriterion | null
}

export type PlayoffFormat = 'two-team' | 'three-team' | 'four-team'

export interface PlayoffRequirement {
  format: PlayoffFormat
  /** Teams ranked above the tie, already in the final. */
  fixedFinalistIds: UUID[]
  tiedTeamIds: UUID[]
  availablePlaces: 1 | 2
}

export type FixtureMatchState =
  | 'unstarted'
  | 'playing'
  | 'completed'
  | 'unnecessary'

export interface Game {
  gameNumber: number
  score: Score
  confirmedAt: string | null
}

export interface FixtureMatch {
  id: UUID
  fixtureId: UUID
  matchNumber: 1 | 2 | 3
  /** Null until both lineups are confirmed and revealed. */
  pairA: LineupPair | null
  pairB: LineupPair | null
  court: Court | null
  state: FixtureMatchState
  resultKind: MatchResultKind | null
  winnerSide: Side | null
  games: Game[]
  version: number
}

export type MatchResultKind = 'played' | 'walkover'

export interface TournamentSnapshot {
  tournament: Tournament
  teams: Team[]
  players: TeamPlayer[]
  fixtures: TeamFixture[]
  matches: FixtureMatch[]
  lineups: Lineup[]
}

export interface TournamentState {
  resetGeneration: number
  snapshot: TournamentSnapshot | null
}

export interface RosterPlayerInput {
  name: string
  seed: Seed
}

export interface RosterTeamInput {
  name: string
  players: [RosterPlayerInput, RosterPlayerInput, RosterPlayerInput, RosterPlayerInput]
}

export interface RosterInput {
  tournamentName: string
  teams: RosterTeamInput[]
}

export interface CourtAssignment {
  matchId: UUID
  court: Court
}

export type StaffRole = 'organizer' | 'referee'

export interface StaffAccess {
  sessionId: UUID
  expiresAt: string
  role: StaffRole
}
