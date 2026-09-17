import { z } from 'zod'

import type { CommandPayloads, MutationInput, MutationReceipt } from '../domain/commands'
import type {
  Court,
  FixtureMatch,
  Game,
  Lineup,
  LineupPair,
  TeamFixture,
  TeamPlayer,
  Team,
  Tournament,
  TournamentSnapshot,
  TournamentState,
} from '../domain/types'
import type { Json } from '../lib/database.types'
import { getSupabaseClient } from '../lib/supabase'

const uuidSchema = z.uuid()
const groupSchema = z.enum(['A', 'B'])
const courtSchema = z.union([z.literal(1), z.literal(2)])
const seedSchema = z.union([z.literal(1), z.literal(2)])
const sideSchema = z.enum(['a', 'b'])
const matchNumberSchema = z.union([z.literal(1), z.literal(2), z.literal(3)])

const tournamentDtoSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  stage: z.enum(['setup', 'groups', 'knockouts', 'completed']),
  setup_locked_at: z.string().nullable(),
  version: z.int().nonnegative(),
  result_revision: z.int().nonnegative(),
})

const teamDtoSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  group_code: groupSchema,
})

const playerDtoSchema = z.object({
  id: uuidSchema,
  team_id: uuidSchema,
  name: z.string(),
  seed: seedSchema,
})

const fixtureDtoSchema = z.object({
  id: uuidSchema,
  stage: z.enum(['group', 'third-place', 'final']),
  group_code: groupSchema.nullable(),
  team_a_id: uuidSchema.nullable(),
  team_b_id: uuidSchema.nullable(),
  version: z.int().nonnegative(),
})

const matchDtoSchema = z.object({
  id: uuidSchema,
  fixture_id: uuidSchema,
  match_number: matchNumberSchema,
  pair_a_seed1_player_id: uuidSchema.nullable(),
  pair_a_seed2_player_id: uuidSchema.nullable(),
  pair_b_seed1_player_id: uuidSchema.nullable(),
  pair_b_seed2_player_id: uuidSchema.nullable(),
  court: courtSchema.nullable(),
  state: z.enum(['unstarted', 'playing', 'completed', 'unnecessary']),
  result_kind: z.enum(['played', 'walkover']).nullable(),
  winner_side: sideSchema.nullable(),
  version: z.int().nonnegative(),
})

const gameDtoSchema = z.object({
  match_id: uuidSchema,
  game_number: z.int().min(1).max(3),
  score_a: z.int().nonnegative(),
  score_b: z.int().nonnegative(),
  confirmed_at: z.string().nullable(),
})

const lineupPairDtoSchema = z.object({
  seed1PlayerId: uuidSchema,
  seed2PlayerId: uuidSchema,
})

const lineupDtoSchema = z.object({
  fixtureId: uuidSchema,
  teamId: uuidSchema,
  pairs: z.tuple([lineupPairDtoSchema, lineupPairDtoSchema, lineupPairDtoSchema]),
  confirmedAt: z.string().nullable(),
})

const snapshotDtoSchema = z.object({
  tournament: tournamentDtoSchema,
  teams: z.array(teamDtoSchema),
  players: z.array(playerDtoSchema),
  fixtures: z.array(fixtureDtoSchema),
  matches: z.array(matchDtoSchema),
  games: z.array(gameDtoSchema),
  lineups: z.array(lineupDtoSchema),
})

const tournamentStateDtoSchema = z.object({
  resetGeneration: z.int().nonnegative(),
  snapshot: snapshotDtoSchema.nullable(),
})

const receiptSchema = z.object({
  requestId: uuidSchema,
  resetGeneration: z.int().nonnegative(),
  tournamentVersion: z.int().nonnegative(),
  matchId: uuidSchema.nullable(),
  matchVersion: z.int().nonnegative().nullable(),
})

type MatchDto = z.infer<typeof matchDtoSchema>
type GameDto = z.infer<typeof gameDtoSchema>

let newestResetGeneration = -1
let newestTournamentId: string | null = null
let newestTournamentVersion = -1
let fetchSequence = 0
let newestAcceptedFetchSequence = -1
let subscriptionSequence = 0

/**
 * Listeners receive the snapshot when one was just fetched, so a subscriber can
 * write it straight into its cache instead of triggering a second fetch of data
 * this module already holds. A bare call means "something changed, go and look".
 */
type InvalidationListener = (state?: TournamentState) => void

const invalidationListeners = new Set<InvalidationListener>()

export class InvalidTournamentDataError extends Error {
  readonly issues: z.core.$ZodIssue[] | undefined

  constructor(message: string, issues?: z.core.$ZodIssue[]) {
    super(message)
    this.name = 'InvalidTournamentDataError'
    this.issues = issues
  }
}

export class StaleTournamentSnapshotError extends Error {
  readonly receivedVersion: number
  readonly requiredVersion: number

  constructor(receivedVersion: number, requiredVersion: number) {
    super(`Received tournament version ${receivedVersion}; expected at least ${requiredVersion}`)
    this.name = 'StaleTournamentSnapshotError'
    this.receivedVersion = receivedVersion
    this.requiredVersion = requiredVersion
  }
}

function parseDto<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    console.error(`${label} validation failed`, { issues: result.error.issues })
    throw new InvalidTournamentDataError(`The server returned an invalid ${label}`, result.error.issues)
  }
  return result.data
}

function mapTournament(dto: z.infer<typeof tournamentDtoSchema>): Tournament {
  return {
    id: dto.id,
    name: dto.name,
    stage: dto.stage,
    setupLockedAt: dto.setup_locked_at,
    version: dto.version,
    resultRevision: dto.result_revision,
  }
}

function mapTeam(dto: z.infer<typeof teamDtoSchema>): Team {
  return { id: dto.id, name: dto.name, group: dto.group_code }
}

function mapPlayer(dto: z.infer<typeof playerDtoSchema>): TeamPlayer {
  return { id: dto.id, teamId: dto.team_id, name: dto.name, seed: dto.seed }
}

function mapFixture(dto: z.infer<typeof fixtureDtoSchema>): TeamFixture {
  if ((dto.stage === 'group') !== (dto.group_code !== null)) {
    throw new InvalidTournamentDataError(`Fixture ${dto.id} has an inconsistent stage and group`)
  }
  return {
    id: dto.id,
    stage: dto.stage,
    group: dto.group_code,
    teamAId: dto.team_a_id,
    teamBId: dto.team_b_id,
    version: dto.version,
  }
}

function mapPair(seed1PlayerId: string | null, seed2PlayerId: string | null): LineupPair | null {
  return seed1PlayerId === null || seed2PlayerId === null ? null : { seed1PlayerId, seed2PlayerId }
}

function mapGame(dto: GameDto): Game {
  return {
    gameNumber: dto.game_number,
    score: { a: dto.score_a, b: dto.score_b },
    confirmedAt: dto.confirmed_at,
  }
}

function mapMatch(dto: MatchDto, games: readonly GameDto[]): FixtureMatch {
  const resolved = dto.result_kind !== null && dto.winner_side !== null
  const consistent = dto.state === 'completed'
    ? resolved
    : dto.result_kind === null && dto.winner_side === null
  const pairA = mapPair(dto.pair_a_seed1_player_id, dto.pair_a_seed2_player_id)
  const pairB = mapPair(dto.pair_b_seed1_player_id, dto.pair_b_seed2_player_id)
  if (!consistent || (pairA === null) !== (pairB === null)) {
    throw new InvalidTournamentDataError(`Match ${dto.id} has inconsistent state and result fields`)
  }
  return {
    id: dto.id,
    fixtureId: dto.fixture_id,
    matchNumber: dto.match_number,
    pairA,
    pairB,
    court: dto.court as Court | null,
    state: dto.state,
    resultKind: dto.result_kind,
    winnerSide: dto.winner_side,
    games: games
      .filter((game) => game.match_id === dto.id)
      .toSorted((first, second) => first.game_number - second.game_number)
      .map(mapGame),
    version: dto.version,
  }
}

function mapLineup(dto: z.infer<typeof lineupDtoSchema>): Lineup {
  return {
    fixtureId: dto.fixtureId,
    teamId: dto.teamId,
    pairs: dto.pairs,
    confirmedAt: dto.confirmedAt,
  }
}

function mapSnapshotDto(dto: z.infer<typeof snapshotDtoSchema>): TournamentSnapshot {
  return {
    tournament: mapTournament(dto.tournament),
    teams: dto.teams.map(mapTeam),
    players: dto.players.map(mapPlayer),
    fixtures: dto.fixtures.map(mapFixture),
    matches: dto.matches.map((match) => mapMatch(match, dto.games)),
    lineups: dto.lineups.map(mapLineup),
  }
}

/**
 * Shared with the preview API, whose before/after bodies are the same shape the
 * snapshot RPC returns. Parsing them in one place keeps a preview from
 * accepting a snapshot the tournament fetch would reject.
 */
export function parseSnapshot(value: unknown): TournamentSnapshot {
  return mapSnapshotDto(parseDto(snapshotDtoSchema, value, 'tournament snapshot'))
}

function mapState(value: unknown): TournamentState {
  const dto = parseDto(tournamentStateDtoSchema, value, 'tournament state')
  return {
    resetGeneration: dto.resetGeneration,
    snapshot: dto.snapshot === null ? null : mapSnapshotDto(dto.snapshot),
  }
}

function toJson(value: unknown): Json {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(toJson)
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toJson(entry)]))
  }
  throw new TypeError('Mutation payload contains a value that cannot be encoded as JSON')
}

async function fetchAtLeast(
  requiredGeneration: number,
  requiredVersion: number,
): Promise<TournamentState> {
  fetchSequence += 1
  const currentFetchSequence = fetchSequence
  const { data, error } = await getSupabaseClient().rpc('get_tournament_snapshot')
  if (error) throw error
  if (data === null) throw new InvalidTournamentDataError('The server returned no tournament state')
  const state = mapState(data)
  const minimumGeneration = Math.max(requiredGeneration, newestResetGeneration)
  if (state.resetGeneration < minimumGeneration) {
    throw new StaleTournamentSnapshotError(state.resetGeneration, minimumGeneration)
  }
  const snapshotId = state.snapshot?.tournament.id ?? null
  // Versions only order snapshots of one tournament; a later fetch that already
  // replaced the identity makes an earlier response unorderable.
  if (state.resetGeneration === newestResetGeneration
    && snapshotId !== newestTournamentId
    && currentFetchSequence < newestAcceptedFetchSequence) {
    throw new StaleTournamentSnapshotError(currentFetchSequence, newestAcceptedFetchSequence)
  }

  const snapshotVersion = state.snapshot?.tournament.version ?? 0
  const sameKnownTournament = state.resetGeneration === newestResetGeneration
    && newestTournamentId !== null
    && snapshotId === newestTournamentId
  const minimumVersion = state.resetGeneration === requiredGeneration
    ? requiredVersion
    : 0
  if ((sameKnownTournament && snapshotVersion < newestTournamentVersion)
    || (state.resetGeneration === requiredGeneration && snapshotVersion < minimumVersion)) {
    throw new StaleTournamentSnapshotError(
      snapshotVersion,
      Math.max(sameKnownTournament ? newestTournamentVersion : 0, minimumVersion),
    )
  }
  newestResetGeneration = state.resetGeneration
  newestTournamentId = snapshotId
  newestTournamentVersion = snapshotVersion
  newestAcceptedFetchSequence = Math.max(newestAcceptedFetchSequence, currentFetchSequence)
  return state
}

export function fetchTournament(): Promise<TournamentState> {
  return fetchAtLeast(0, 0)
}

function notifyInvalidation(state?: TournamentState): void {
  for (const listener of invalidationListeners) listener(state)
}

async function refreshAndNotify(requiredGeneration: number, requiredVersion: number): Promise<void> {
  notifyInvalidation(await fetchAtLeast(requiredGeneration, requiredVersion))
}

export async function mutateTournament<K extends keyof CommandPayloads>(
  operation: K,
  input: MutationInput<K>,
): Promise<MutationReceipt> {
  const { data, error } = await getSupabaseClient().rpc(operation, {
    p_request_id: input.requestId,
    p_reset_generation: input.resetGeneration,
    p_expected_version: input.expectedVersion,
    p_payload: toJson(input.payload),
  })
  if (error) throw error
  const receipt = parseDto(receiptSchema, data, 'mutation receipt')
  await refreshAndNotify(receipt.resetGeneration, receipt.tournamentVersion)
  return receipt
}

/**
 * Digs the new row's version out of a realtime payload, tolerating every shape
 * that carries no version: a delete event, or a payload we did not expect.
 */
function changedVersion(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null
  const { new: record } = payload as { new?: unknown }
  if (typeof record !== 'object' || record === null) return null
  const { version } = record as { version?: unknown }
  return typeof version === 'number' ? version : null
}

function changedGeneration(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null
  const { new: record } = payload as { new?: unknown }
  if (typeof record !== 'object' || record === null) return null
  const { reset_generation: generation } = record as { reset_generation?: unknown }
  return typeof generation === 'number' ? generation : null
}

export function subscribeTournament(onChange: InvalidationListener): () => void {
  invalidationListeners.add(onChange)
  let disconnectedAfterSubscription = false
  let subscribed = false
  let active = true

  const refreshAfterReconnect = () => {
    void refreshAndNotify(newestResetGeneration, newestTournamentVersion).catch((error: unknown) => {
      console.error('Tournament refresh after reconnect failed', { error })
    })
  }
  const handleOnline = () => refreshAfterReconnect()
  if (typeof window !== 'undefined') window.addEventListener('online', handleOnline)

  subscriptionSequence += 1
  const channel = getSupabaseClient()
    .channel(`public-tournament-invalidations-${subscriptionSequence}`)
    /*
     * Every mutation bumps `tournament.version`, so this one table is a
     * complete change signal. Watching the whole schema meant a single point
     * produced two events — one for `matches`, one for `tournament`.
     */
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament' }, (payload) => {
      // A mutation made here already fetched and published this version through
      // `refreshAndNotify`; its echo would only refetch what we already hold.
      const version = changedVersion(payload)
      if (version !== null && version <= newestTournamentVersion) return
      notifyInvalidation()
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_generation' }, (payload) => {
      const generation = changedGeneration(payload)
      if (generation !== null && generation <= newestResetGeneration) return
      notifyInvalidation()
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (subscribed && disconnectedAfterSubscription) refreshAfterReconnect()
        subscribed = true
        disconnectedAfterSubscription = false
      } else if (subscribed) {
        disconnectedAfterSubscription = true
      }
    })

  return () => {
    if (!active) return
    active = false
    invalidationListeners.delete(onChange)
    if (typeof window !== 'undefined') window.removeEventListener('online', handleOnline)
    void getSupabaseClient().removeChannel(channel)
  }
}
