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
}

export interface Player {
  id: UUID
  name: string
  seed: Seed
}

export interface Pair {
  id: UUID
  teamName: string | null
  playerAId: UUID
  playerBId: UUID
  group: Group
  withdrawn: boolean
}

export type MatchRound = 'group' | 'semifinal' | 'final'
export type MatchResultKind = 'played' | 'walkover'

interface MatchBase {
  id: UUID
  round: MatchRound
  group: Group | null
  pairAId: UUID | null
  pairBId: UUID | null
  sourceALabel: string | null
  sourceBLabel: string | null
  sourceAMatchId: UUID | null
  sourceBMatchId: UUID | null
  court: Court | null
  playingOrder: number
  version: number
}

export interface UnstartedMatch extends MatchBase {
  state: 'unstarted'
  score: null
  resultKind: null
  winnerId: null
}

export interface PlayingMatch extends MatchBase {
  state: 'playing'
  score: Score
  resultKind: null
  winnerId: null
}

export interface CompletedPlayedMatch extends MatchBase {
  state: 'completed'
  score: Score
  resultKind: 'played'
  winnerId: UUID
}

export interface CompletedWalkoverMatch extends MatchBase {
  state: 'completed'
  score: null
  resultKind: 'walkover'
  winnerId: UUID
}

export interface VoidMatch extends MatchBase {
  state: 'void'
  score: null
  resultKind: null
  winnerId: null
}

export type Match =
  | UnstartedMatch
  | PlayingMatch
  | CompletedPlayedMatch
  | CompletedWalkoverMatch
  | VoidMatch

export interface TieResolution {
  group: Group
  orderedPairIds: UUID[]
  explanation: string
  standingsRevision: number
}

export interface TournamentSnapshot {
  tournament: Tournament
  players: Player[]
  pairs: Pair[]
  matches: Match[]
  tieResolutions: TieResolution[]
}

export type StandingTieStatus =
  | 'clear'
  | 'head-to-head'
  | 'mini-table'
  | 'manual'

export interface Standing {
  pairId: UUID
  rank: number | null
  played: number
  wins: number
  losses: number
  pointsFor: number
  pointsAgainst: number
  pointDifference: number
  tieStatus: StandingTieStatus
}

interface FixtureBase {
  round: MatchRound
  group: Group | null
  court: Court | null
  playingOrder: number
}

export interface GroupFixture extends FixtureBase {
  round: 'group'
  group: Group
  pairAId: UUID
  pairBId: UUID
  sourceALabel: null
  sourceBLabel: null
}

export interface KnockoutFixture extends FixtureBase {
  round: 'semifinal' | 'final'
  group: null
  pairAId: null
  pairBId: null
  sourceALabel: 'A1' | 'B1' | 'SF1 winner'
  sourceBLabel: 'A2' | 'B2' | 'SF2 winner'
}

export type Fixture = GroupFixture | KnockoutFixture

export interface SetupPlayerInput {
  name: string
  seed: Seed
}

export interface SetupPairInput {
  teamName: string | null
  players: [SetupPlayerInput, SetupPlayerInput]
  group: Group
}

export interface SetupInput {
  tournamentName: string
  pairs: SetupPairInput[]
}

export interface CourtAssignment {
  matchId: UUID
  court: Court
  playingOrder: number
}

export interface StaffAccess {
  sessionId: UUID
  expiresAt: string
}
