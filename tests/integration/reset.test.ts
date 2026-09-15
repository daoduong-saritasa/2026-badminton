import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import resetMigration from '../../supabase/migrations/202609150002_maintenance_reset.sql?raw'

import {
  anonymousRpc,
  elevate,
  mutation,
  requireLocalSupabase,
  resetLocalDatabase,
  rpc,
  runSql,
  signInAnonymously,
  type LocalSession,
} from './local-supabase.ts'

interface Snapshot {
  matches: Array<{
    court: number | null
    id: string
    playing_order: number
    score_a: number | null
    score_b: number | null
    state: string
    version: number
  }>
  pairs: Array<{ id: string; withdrawn: boolean }>
  players: Array<{ id: string }>
  tieResolutions: unknown[]
  tournament: {
    court_count: number | null
    id: string
    name: string
    setup_locked_at: string | null
    stage: string
    version: number
  }
}

interface TournamentState {
  resetGeneration: number
  snapshot: Snapshot | null
}

function setupPayload(): Record<string, unknown> {
  return {
    setup: {
      tournamentName: 'Reset integration',
      courtCount: 2,
      pairs: Array.from({ length: 4 }, (_, index) => ({
        teamName: `Pair ${index + 1}`,
        group: index < 2 ? 'A' : 'B',
        players: [
          { name: `Player ${index * 2 + 1}`, seed: 1 },
          { name: `Player ${index * 2 + 2}`, seed: 2 },
        ],
      })),
    },
  }
}

async function state(session?: LocalSession): Promise<TournamentState> {
  const response = await rpc('get_tournament_snapshot', {}, session)
  expect(response.ok).toBe(true)
  return (await response.json()) as TournamentState
}

async function createTournament(session: LocalSession): Promise<Snapshot> {
  const setup = await rpc('save_setup', mutation(0, setupPayload()), session)
  expect(setup.ok).toBe(true)
  const receipt = await setup.json() as { tournamentVersion: number }
  const fixtures = await rpc('generate_fixtures', mutation(receipt.tournamentVersion, {}), session)
  expect(fixtures.ok).toBe(true)
  const current = await state(session)
  if (current.snapshot === null) throw new Error('Tournament setup did not create a snapshot')
  return current.snapshot
}

function resetBody(
  target: TournamentState,
  mode: 'progress' | 'all',
  requestId = crypto.randomUUID(),
): Record<string, unknown> {
  if (target.snapshot === null) throw new Error('Reset target is empty')
  return {
    p_request_id: requestId,
    p_expected_generation: target.resetGeneration,
    p_expected_tournament_id: target.snapshot.tournament.id,
    p_expected_version: target.snapshot.tournament.version,
    p_mode: mode,
    p_confirmation_name: target.snapshot.tournament.name,
  }
}

describe('tournament maintenance reset', () => {
  beforeAll(async () => {
    expect(resetMigration).toContain('create table private.maintenance_state')
    expect(resetMigration).toContain('grant execute on function public.reset_tournament')
    await requireLocalSupabase()
  })

  beforeEach(() => {
    resetLocalDatabase()
  })

  it('denies reset control to anonymous and staff callers and rejects old mutation signatures', async () => {
    const staff = await signInAnonymously()
    await elevate(staff)
    const target = await createTournament(staff)
    const current = await state(staff)
    const body = resetBody(current, 'progress')

    expect((await anonymousRpc('set_reset_enabled', { p_enabled: true })).ok).toBe(false)
    expect((await rpc('set_reset_enabled', { p_enabled: true }, staff)).ok).toBe(false)
    expect((await anonymousRpc('reset_tournament', body)).ok).toBe(false)
    expect((await rpc('reset_tournament', body, staff)).ok).toBe(false)
    expect((await rpc('save_setup', {
      p_request_id: crypto.randomUUID(),
      p_expected_version: target.tournament.version,
      p_payload: setupPayload(),
    }, staff)).ok).toBe(false)
  })

  it('requires the enable flag and rolls back a stale or mistyped target', async () => {
    const staff = await signInAnonymously()
    await elevate(staff)
    await createTournament(staff)
    const before = await state(staff)
    const body = resetBody(before, 'progress')

    expect((await rpc('reset_tournament', body)).ok).toBe(false)
    expect(await state(staff)).toEqual(before)

    expect((await rpc('set_reset_enabled', { p_enabled: true })).ok).toBe(true)
    expect((await rpc('reset_tournament', { ...body, p_confirmation_name: 'Wrong name' })).ok).toBe(false)
    expect(await state(staff)).toEqual(before)
    expect(runSql('select reset_enabled from private.maintenance_state where singleton;')).toBe('t')
  })

  it('resets active progress while preserving setup, fixtures, schedule, staff, and audit history', async () => {
    const staff = await signInAnonymously()
    await elevate(staff)
    const snapshot = await createTournament(staff)
    const match = snapshot.matches[0]
    const pair = snapshot.pairs[0]
    if (!match || !pair) throw new Error('Reset fixture is incomplete')
    const start = await rpc('start_scoring', mutation(match.version ?? 0, { matchId: match.id }), staff)
    expect(start.ok).toBe(true)
    const startReceipt = await start.json() as { matchVersion: number }
    expect((await rpc('add_point', mutation(startReceipt.matchVersion, { matchId: match.id, side: 'a' }), staff)).ok).toBe(true)
    runSql(`update public.pairs set withdrawn = true where id = '${pair.id}'::uuid;`)

    const before = await state(staff)
    const schedule = before.snapshot?.matches.map(({ id, court, playing_order }) => ({ id, court, playing_order }))
    expect((await rpc('set_reset_enabled', { p_enabled: true })).ok).toBe(true)
    const reset = await rpc('reset_tournament', resetBody(before, 'progress'))
    expect(reset.ok).toBe(true)

    const after = await state(staff)
    expect(after.resetGeneration).toBe(1)
    expect(after.snapshot).toMatchObject({
      tournament: {
        id: before.snapshot?.tournament.id,
        name: 'Reset integration',
        court_count: 2,
        setup_locked_at: null,
        stage: 'setup',
      },
    })
    expect(after.snapshot?.matches.map(({ id, court, playing_order }) => ({ id, court, playing_order }))).toEqual(schedule)
    expect(after.snapshot?.matches.every((candidate) =>
      candidate.state === 'unstarted' && candidate.score_a === null && candidate.score_b === null,
    )).toBe(true)
    expect(after.snapshot?.pairs.every((candidate) => !candidate.withdrawn)).toBe(true)
    expect(after.snapshot?.tieResolutions).toEqual([])
    expect((await rpc('get_staff_access', {}, staff)).ok).toBe(true)
    expect(runSql('select count(*) from private.match_ownership;')).toBe('0')
    expect(runSql("select count(*) from private.mutation_log where actor_kind = 'maintenance' and maintenance_mode = 'progress';")).toBe('1')
    expect(runSql('select reset_enabled from private.maintenance_state where singleton;')).toBe('f')

    const resetMatch = after.snapshot?.matches.find((candidate) => candidate.id === match.id)
    if (!resetMatch) throw new Error('Progress reset removed a fixture')
    const restarted = await rpc(
      'start_scoring',
      mutation(resetMatch.version, { matchId: resetMatch.id }, crypto.randomUUID(), 1),
      staff,
    )
    expect(restarted.ok).toBe(true)
    const restartedReceipt = await restarted.json() as { matchVersion: number }
    expect((await rpc(
      'undo_point',
      mutation(restartedReceipt.matchVersion, { matchId: resetMatch.id }, crypto.randomUUID(), 1),
      staff,
    )).ok).toBe(false)
  })

  it('clears completed setup, retains access and history, rejects stale writes, and safely replays the reset', async () => {
    const staff = await signInAnonymously()
    await elevate(staff)
    await createTournament(staff)
    runSql("update public.tournament set stage = 'completed', version = version + 1 where singleton;")
    const before = await state(staff)
    const requestId = crypto.randomUUID()
    const body = resetBody(before, 'all', requestId)
    const staffLogCount = Number(runSql("select count(*) from private.mutation_log where actor_kind = 'staff';"))

    expect((await rpc('set_reset_enabled', { p_enabled: true })).ok).toBe(true)
    const first = await rpc('reset_tournament', body)
    expect(first.ok).toBe(true)
    const firstReceipt = await first.json()
    const replay = await rpc('reset_tournament', body)
    expect(replay.ok).toBe(true)
    expect(await replay.json()).toEqual(firstReceipt)

    const empty = await state(staff)
    expect(empty).toEqual({ resetGeneration: 1, snapshot: null })
    expect((await rpc('get_staff_access', {}, staff)).ok).toBe(true)
    expect(Number(runSql("select count(*) from private.mutation_log where actor_kind = 'staff';"))).toBe(staffLogCount)
    expect(runSql("select count(*) from private.mutation_log where actor_kind = 'maintenance' and maintenance_mode = 'all';")).toBe('1')
    expect((await rpc('save_setup', mutation(0, setupPayload()), staff)).ok).toBe(false)
    expect((await rpc('save_setup', mutation(0, setupPayload(), crypto.randomUUID(), 1), staff)).ok).toBe(true)
  })
})
