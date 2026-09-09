import { z } from 'zod'

import type { CommandPayloads, MutationInput, MutationReceipt } from '../domain/commands'
import type {
  Court,
  Group,
  Match,
  Pair,
  Player,
  Seed,
  TieResolution,
  Tournament,
  TournamentSnapshot,
} from '../domain/types'
import type { Json } from '../lib/database.types'
import { getSupabaseClient } from '../lib/supabase'

const uuidSchema = z.uuid()
const groupSchema = z.enum(['A', 'B'])
const courtSchema = z.union([z.literal(1), z.literal(2)])

const tournamentDtoSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  stage: z.enum(['setup', 'groups', 'knockouts', 'completed']),
  setup_locked_at: z.string().nullable(),
  version: z.int().nonnegative(),
})

const playerDtoSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  seed: z.union([z.literal(1), z.literal(2)]),
})

const pairDtoSchema = z.object({
  id: uuidSchema,
  team_name: z.string().nullable(),
  player_a_id: uuidSchema,
  player_b_id: uuidSchema,
  group_code: groupSchema,
  withdrawn: z.boolean(),
})

const matchDtoSchema = z.object({
  id: uuidSchema,
  round: z.enum(['group', 'semifinal', 'final']),
  group_code: groupSchema.nullable(),
  pair_a_id: uuidSchema.nullable(),
  pair_b_id: uuidSchema.nullable(),
  source_a_label: z.string().nullable(),
  source_b_label: z.string().nullable(),
  source_a_match_id: uuidSchema.nullable(),
  source_b_match_id: uuidSchema.nullable(),
  court: courtSchema.nullable(),
  playing_order: z.int().nonnegative(),
  version: z.int().nonnegative(),
  state: z.enum(['unstarted', 'playing', 'completed', 'void']),
  score_a: z.int().nonnegative().nullable(),
  score_b: z.int().nonnegative().nullable(),
  result_kind: z.enum(['played', 'walkover']).nullable(),
  winner_id: uuidSchema.nullable(),
})

const tieResolutionDtoSchema = z.object({
  group_code: groupSchema,
  ordered_pair_ids: z.array(uuidSchema),
  explanation: z.string(),
  standings_revision: z.int().nonnegative(),
})

const snapshotDtoSchema = z.object({
  tournament: tournamentDtoSchema,
  players: z.array(playerDtoSchema),
  pairs: z.array(pairDtoSchema),
  matches: z.array(matchDtoSchema),
  tieResolutions: z.array(tieResolutionDtoSchema),
})

const receiptSchema = z.object({
  requestId: uuidSchema,
  tournamentVersion: z.int().nonnegative(),
  matchId: uuidSchema.nullable(),
  matchVersion: z.int().nonnegative().nullable(),
})

type MatchDto = z.infer<typeof matchDtoSchema>

let newestTournamentVersion = -1
let subscriptionSequence = 0

/**
 * Listeners receive the snapshot when one was just fetched, so a subscriber can
 * write it straight into its cache instead of triggering a second fetch of data
 * this module already holds. A bare call means "something changed, go and look".
 */
type InvalidationListener = (snapshot?: TournamentSnapshot) => void

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

export class TournamentNotConfiguredError extends Error {
  constructor() {
    super('No tournament has been configured yet')
    this.name = 'TournamentNotConfiguredError'
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
  }
}

function mapPlayer(dto: z.infer<typeof playerDtoSchema>): Player {
  return { id: dto.id, name: dto.name, seed: dto.seed as Seed }
}

function mapPair(dto: z.infer<typeof pairDtoSchema>): Pair {
  return {
    id: dto.id,
    teamName: dto.team_name,
    playerAId: dto.player_a_id,
    playerBId: dto.player_b_id,
    group: dto.group_code as Group,
    withdrawn: dto.withdrawn,
  }
}

function matchBase(dto: MatchDto) {
  return {
    id: dto.id,
    round: dto.round,
    group: dto.group_code,
    pairAId: dto.pair_a_id,
    pairBId: dto.pair_b_id,
    sourceALabel: dto.source_a_label,
    sourceBLabel: dto.source_b_label,
    sourceAMatchId: dto.source_a_match_id,
    sourceBMatchId: dto.source_b_match_id,
    court: dto.court as Court | null,
    playingOrder: dto.playing_order,
    version: dto.version,
  }
}

function mapMatch(dto: MatchDto): Match {
  const base = matchBase(dto)
  if (dto.state === 'unstarted' && dto.score_a === null && dto.score_b === null && dto.result_kind === null && dto.winner_id === null) {
    return { ...base, state: 'unstarted', score: null, resultKind: null, winnerId: null }
  }
  if (dto.state === 'playing' && dto.score_a !== null && dto.score_b !== null && dto.result_kind === null && dto.winner_id === null) {
    return { ...base, state: 'playing', score: { a: dto.score_a, b: dto.score_b }, resultKind: null, winnerId: null }
  }
  if (dto.state === 'completed' && dto.result_kind === 'played' && dto.score_a !== null && dto.score_b !== null && dto.winner_id !== null) {
    return { ...base, state: 'completed', score: { a: dto.score_a, b: dto.score_b }, resultKind: 'played', winnerId: dto.winner_id }
  }
  if (dto.state === 'completed' && dto.result_kind === 'walkover' && dto.score_a === null && dto.score_b === null && dto.winner_id !== null) {
    return { ...base, state: 'completed', score: null, resultKind: 'walkover', winnerId: dto.winner_id }
  }
  if (dto.state === 'void' && dto.score_a === null && dto.score_b === null && dto.result_kind === null && dto.winner_id === null) {
    return { ...base, state: 'void', score: null, resultKind: null, winnerId: null }
  }
  throw new InvalidTournamentDataError(`Match ${dto.id} has inconsistent state and result fields`)
}

function mapTieResolution(dto: z.infer<typeof tieResolutionDtoSchema>): TieResolution {
  return {
    group: dto.group_code as Group,
    orderedPairIds: dto.ordered_pair_ids,
    explanation: dto.explanation,
    standingsRevision: dto.standings_revision,
  }
}

function mapSnapshot(value: unknown): TournamentSnapshot {
  const dto = parseDto(snapshotDtoSchema, value, 'tournament snapshot')
  return {
    tournament: mapTournament(dto.tournament),
    players: dto.players.map(mapPlayer),
    pairs: dto.pairs.map(mapPair),
    matches: dto.matches.map(mapMatch),
    tieResolutions: dto.tieResolutions.map(mapTieResolution),
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

async function fetchAtLeast(requiredVersion: number): Promise<TournamentSnapshot> {
  const { data, error } = await getSupabaseClient().rpc('get_tournament_snapshot')
  if (error) throw error
  if (data === null) throw new TournamentNotConfiguredError()
  const snapshot = mapSnapshot(data)
  const minimumVersion = Math.max(requiredVersion, newestTournamentVersion)
  if (snapshot.tournament.version < minimumVersion) {
    throw new StaleTournamentSnapshotError(snapshot.tournament.version, minimumVersion)
  }
  newestTournamentVersion = snapshot.tournament.version
  return snapshot
}

export function fetchTournament(): Promise<TournamentSnapshot> {
  return fetchAtLeast(0)
}

function notifyInvalidation(snapshot?: TournamentSnapshot): void {
  for (const listener of invalidationListeners) listener(snapshot)
}

async function refreshAndNotify(requiredVersion: number): Promise<void> {
  notifyInvalidation(await fetchAtLeast(requiredVersion))
}

export async function mutateTournament<K extends keyof CommandPayloads>(
  operation: K,
  input: MutationInput<K>,
): Promise<MutationReceipt> {
  const { data, error } = await getSupabaseClient().rpc(operation, {
    p_request_id: input.requestId,
    p_expected_version: input.expectedVersion,
    p_payload: toJson(input.payload),
  })
  if (error) throw error
  const receipt = parseDto(receiptSchema, data, 'mutation receipt')
  await refreshAndNotify(receipt.tournamentVersion)
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

export function subscribeTournament(onChange: InvalidationListener): () => void {
  invalidationListeners.add(onChange)
  let disconnectedAfterSubscription = false
  let subscribed = false
  let active = true

  const refreshAfterReconnect = () => {
    void refreshAndNotify(newestTournamentVersion).catch((error: unknown) => {
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
