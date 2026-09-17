export type UUID = string

export type Group = 'A' | 'B'
export type Side = 'a' | 'b'
export type Seed = 1 | 2
export type Court = 1 | 2

export interface Score {
  a: number
  b: number
}

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
}

export interface Player {
  id: UUID
  name: string
  seed: Seed
}

export interface Team {
  id: UUID
  name: string
  group: Group
}

export interface TeamPlayer extends Player {
  teamId: UUID
}

export interface LineupPair {
  seed1PlayerId: UUID
  seed2PlayerId: UUID
}

export interface Lineup {
  fixtureId: UUID
  teamId: UUID
  pairs: [LineupPair, LineupPair, LineupPair]
  confirmedAt: string | null
}

export type FixtureStage = 'group' | 'third-place' | 'final'

export interface TeamFixture {
  id: UUID
  stage: FixtureStage
  group: Group | null
  teamAId: UUID | null
  teamBId: UUID | null
  version: number
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
  group: Group
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
