import {
  anonymousRpc,
  elevate,
  mutation,
  rpc,
  signInAnonymously,
  type LocalSession,
} from '../../integration/local-supabase.ts'

export type { LocalSession }
export type Side = 'a' | 'b'
export type Stage = 'qualifying' | 'qualification-playoff' | 'third-place' | 'final'

export interface Player {
  id: string
  team_id: string
  name: string
  seed: 1 | 2
}

export interface Team {
  id: string
  name: string
}

export interface Fixture {
  id: string
  stage: Stage
  team_a_id: string | null
  team_b_id: string | null
  playoff_round_id: string | null
  version: number
}

export interface Match {
  id: string
  fixture_id: string
  match_number: 1 | 2 | 3
  court: 1 | 2 | null
  state: 'unstarted' | 'playing' | 'completed' | 'unnecessary'
  winner_side: Side | null
  pair_a_player_1_id: string | null
  pair_a_player_2_id: string | null
  pair_b_player_1_id: string | null
  pair_b_player_2_id: string | null
  version: number
}

export interface Game {
  match_id: string
  game_number: number
  score_a: number
  score_b: number
  confirmed_at: string | null
}

export interface PlayoffRound {
  id: string
  round_number: number
  team_ids: string[]
}

export interface Snapshot {
  tournament: {
    id: string
    name: string
    stage: 'setup' | 'groups' | 'knockouts' | 'completed'
    version: number
    result_revision: number
    finalists_confirmed_at: string | null
    current_playoff_round_id: string | null
    court_names: [string, string]
  }
  teams: Team[]
  players: Player[]
  fixtures: Fixture[]
  matches: Match[]
  games: Game[]
  playoff_rounds: PlayoffRound[]
}

export interface TournamentState {
  resetGeneration: number
  snapshot: Snapshot
}

export interface Receipt {
  tournamentVersion: number
  matchId: string | null
  matchVersion: number | null
}

export interface Pair {
  player1Id: string
  player2Id: string
}

/** A rejected RPC, carrying the database's message. */
export class RpcError extends Error {
  readonly status: number

  constructor(operation: string, status: number, detail: string) {
    super(`${operation} returned ${status}: ${detail}`)
    this.name = 'RpcError'
    this.status = status
  }
}

async function parse<T>(operation: string, response: Response): Promise<T> {
  const body: unknown = await response.json()
  if (!response.ok) {
    const detail = typeof body === 'object' && body !== null && 'message' in body ? String(body.message) : JSON.stringify(body)
    throw new RpcError(operation, response.status, detail)
  }
  return body as T
}

/** A new anonymous session holding the staff grant for `pin`. */
export async function signInStaff(pin: string): Promise<LocalSession> {
  const session = await signInAnonymously()
  await elevate(session, pin)
  return session
}

/** The tournament as the public sees it. Throws when no tournament exists. */
export async function readState(): Promise<TournamentState> {
  const state = await parse<{ resetGeneration: number; snapshot: Snapshot | null }>(
    'get_tournament_snapshot',
    await anonymousRpc('get_tournament_snapshot', {}),
  )
  if (!state.snapshot) throw new Error('The local database has no tournament')
  return { resetGeneration: state.resetGeneration, snapshot: state.snapshot }
}

export function findMatch(snapshot: Snapshot, matchId: string): Match {
  const match = snapshot.matches.find((candidate) => candidate.id === matchId)
  if (!match) throw new Error(`Match ${matchId} is not in the snapshot`)
  return match
}

/** Runs a command guarded by the tournament version. */
export async function tournamentCommand(
  session: LocalSession,
  operation: string,
  payload: Record<string, unknown>,
): Promise<Receipt> {
  const { resetGeneration, snapshot } = await readState()
  const body = mutation(snapshot.tournament.version, payload, crypto.randomUUID(), resetGeneration)
  return parse<Receipt>(operation, await rpc(operation, body, session))
}

/** Runs a command guarded by one match's version; `matchId` joins the payload. */
export async function matchCommand(
  session: LocalSession,
  operation: string,
  matchId: string,
  payload: Record<string, unknown> = {},
  expectedVersion?: number,
): Promise<Receipt> {
  const { resetGeneration, snapshot } = await readState()
  const version = expectedVersion ?? findMatch(snapshot, matchId).version
  const body = mutation(version, { matchId, ...payload }, crypto.randomUUID(), resetGeneration)
  return parse<Receipt>(operation, await rpc(operation, body, session))
}

/** Runs a command guarded by one fixture's version; `fixtureId` joins the payload. */
export async function fixtureCommand(
  session: LocalSession,
  operation: string,
  fixtureId: string,
  payload: Record<string, unknown>,
): Promise<Receipt> {
  const { resetGeneration, snapshot } = await readState()
  const fixture = snapshot.fixtures.find((candidate) => candidate.id === fixtureId)
  if (!fixture) throw new Error(`Fixture ${fixtureId} is not in the snapshot`)
  const body = mutation(fixture.version, { fixtureId, ...payload }, crypto.randomUUID(), resetGeneration)
  return parse<Receipt>(operation, await rpc(operation, body, session))
}
