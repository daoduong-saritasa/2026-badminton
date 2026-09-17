import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import previewMigration from '../../supabase/migrations/202609150003_result_previews.sql?raw'

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
    pair_a_id: string | null
    pair_b_id: string | null
    playing_order: number
    result_kind: string | null
    round: string
    score_a: number | null
    score_b: number | null
    state: string
    version: number
    winner_id: string | null
  }>
  pairs: Array<{ group_code: string; id: string; withdrawn: boolean }>
  players: Array<{ id: string }>
  tieResolutions: Array<{ group_code: string }>
  tournament: { id: string; result_revision: number; stage: string; version: number }
}

interface TournamentState {
  resetGeneration: number
  snapshot: Snapshot | null
}

interface Impact {
  after: Snapshot | null
  before: Snapshot
  blockedReason: string | null
  resetGeneration: number
  tournamentVersion: number
}

function setupPayload(pairCount = 4): Record<string, unknown> {
  return {
    setup: {
      tournamentName: 'Preview integration',
      courtCount: 2,
      pairs: Array.from({ length: pairCount }, (_, index) => ({
        teamName: `Pair ${index + 1}`,
        group: index < pairCount / 2 ? 'A' : 'B',
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

async function createTournament(session: LocalSession, pairCount = 4): Promise<Snapshot> {
  const setup = await rpc('save_setup', mutation(0, setupPayload(pairCount)), session)
  expect(setup.ok).toBe(true)
  const receipt = await setup.json() as { tournamentVersion: number }
  expect((await rpc('generate_fixtures', mutation(receipt.tournamentVersion, {}), session)).ok).toBe(true)
  const current = await state(session)
  if (current.snapshot === null) throw new Error('Setup did not create a snapshot')
  return current.snapshot
}

/** Plays out every group match so knockout fixtures gain participants. */
async function completeGroupStage(session: LocalSession): Promise<Snapshot> {
  for (;;) {
    const current = await state(session)
    const next = current.snapshot?.matches.find(
      (match) => match.round === 'group' && match.state === 'unstarted'
        && match.pair_a_id !== null && match.pair_b_id !== null,
    )
    if (!next) break
    expect((await rpc('enter_result', mutation(next.version, {
      matchId: next.id,
      score: { a: 21, b: 10 },
    }), session)).ok).toBe(true)
  }
  const completed = await state(session)
  if (completed.snapshot === null) throw new Error('Group stage vanished')
  return completed.snapshot
}

async function previewCorrection(
  matchId: string,
  score: { a: number; b: number },
  session: LocalSession,
  resetGeneration = 0,
): Promise<Response> {
  return rpc('preview_result_correction', {
    p_match_id: matchId,
    p_score: score,
    p_reset_generation: resetGeneration,
  }, session)
}

async function previewWithdrawal(
  pairId: string,
  session: LocalSession,
  resetGeneration = 0,
): Promise<Response> {
  return rpc('preview_withdrawal', { p_pair_id: pairId, p_reset_generation: resetGeneration }, session)
}

function mutationLogCount(): string {
  return runSql('select count(*)::text from private.mutation_log;')
}

describe('result and withdrawal previews', () => {
  beforeAll(async () => {
    expect(previewMigration).toContain('create or replace function public.preview_result_correction')
    expect(previewMigration).toContain('create or replace function public.preview_withdrawal')
    expect(previewMigration).toContain('previewTournamentVersion')
    await requireLocalSupabase()
  })

  beforeEach(() => {
    resetLocalDatabase()
  })

  it('denies previews to anonymous callers and to signed-in callers without staff access', async () => {
    const staff = await signInAnonymously()
    await elevate(staff)
    const created = await createTournament(staff)
    const match = created.matches.find((candidate) => candidate.pair_a_id !== null)
    if (!match) throw new Error('Fixture has no playable match')

    expect((await anonymousRpc('preview_result_correction', {
      p_match_id: match.id,
      p_score: { a: 21, b: 10 },
      p_reset_generation: 0,
    })).ok).toBe(false)

    const plain = await signInAnonymously()
    expect((await previewCorrection(match.id, { a: 21, b: 10 }, plain)).ok).toBe(false)
    expect((await previewWithdrawal(created.pairs[0].id, plain)).ok).toBe(false)
  })

  it('projects a result without writing anything', async () => {
    const staff = await signInAnonymously()
    await elevate(staff)
    const created = await createTournament(staff)
    const match = created.matches.find((candidate) => candidate.pair_a_id !== null)
    if (!match) throw new Error('Fixture has no playable match')

    const logBefore = mutationLogCount()
    const response = await previewCorrection(match.id, { a: 21, b: 10 }, staff)
    expect(response.ok).toBe(true)
    const impact = await response.json() as Impact

    expect(impact.blockedReason).toBeNull()
    expect(impact.tournamentVersion).toBe(created.tournament.version)
    expect(impact.before.matches.find((candidate) => candidate.id === match.id)?.state).toBe('unstarted')
    expect(impact.after?.matches.find((candidate) => candidate.id === match.id)).toMatchObject({
      score_a: 21,
      score_b: 10,
      state: 'completed',
      winner_id: match.pair_a_id,
    })

    expect(mutationLogCount()).toBe(logBefore)
    expect(await state(staff)).toEqual({ resetGeneration: 0, snapshot: created })
  })

  it('projects exactly what saving then produces', async () => {
    const staff = await signInAnonymously()
    await elevate(staff)
    const created = await createTournament(staff)
    const match = created.matches.find((candidate) => candidate.pair_a_id !== null)
    if (!match) throw new Error('Fixture has no playable match')

    const projected = await (await previewCorrection(match.id, { a: 21, b: 10 }, staff)).json() as Impact
    expect((await rpc('enter_result', mutation(match.version, {
      matchId: match.id,
      score: { a: 21, b: 10 },
    }), staff)).ok).toBe(true)

    const applied = await state(staff)
    expect(applied.snapshot?.matches).toEqual(projected.after?.matches)
    expect(applied.snapshot?.pairs).toEqual(projected.after?.pairs)
    expect(applied.snapshot?.tieResolutions).toEqual(projected.after?.tieResolutions)
  })

  it('previews a correction and applies exactly what it projected', async () => {
    const staff = await signInAnonymously()
    await elevate(staff)
    const created = await createTournament(staff)
    const match = created.matches.find((candidate) => candidate.pair_a_id !== null)
    if (!match) throw new Error('Fixture has no playable match')

    expect((await rpc('enter_result', mutation(match.version, {
      matchId: match.id,
      score: { a: 21, b: 10 },
    }), staff)).ok).toBe(true)

    const completedState = await state(staff)
    const completed = completedState.snapshot?.matches.find((candidate) => candidate.id === match.id)
    if (!completed) throw new Error('Completed match vanished')
    expect(completed.state).toBe('completed')

    // No knockout match has started, so reversing this group result is allowed.
    const response = await previewCorrection(match.id, { a: 15, b: 21 }, staff)
    expect(response.ok).toBe(true)
    const impact = await response.json() as Impact
    expect(impact.blockedReason).toBeNull()
    expect(impact.tournamentVersion).toBe(completedState.snapshot?.tournament.version)
    expect(impact.after?.matches.find((candidate) => candidate.id === match.id)).toMatchObject({
      score_a: 15,
      score_b: 21,
      winner_id: match.pair_b_id,
    })

    const saved = await rpc('correct_result', mutation(completed.version, {
      matchId: match.id,
      score: { a: 15, b: 21 },
      previewTournamentVersion: impact.tournamentVersion,
    }), staff)
    expect(saved.ok).toBe(true)

    const applied = await state(staff)
    expect(applied.snapshot?.matches).toEqual(impact.after?.matches)
    expect(applied.snapshot?.pairs).toEqual(impact.after?.pairs)
    expect(applied.snapshot?.tieResolutions).toEqual(impact.after?.tieResolutions)
  })

  it('blocks every group correction once knockout play starts, including a same-winner score change', async () => {
    const staff = await signInAnonymously()
    await elevate(staff)
    await createTournament(staff)
    const completed = await completeGroupStage(staff)
    expect((await rpc('confirm_groups', mutation(completed.tournament.version, {}), staff)).ok).toBe(true)

    const knockouts = await state(staff)
    const semifinal = knockouts.snapshot?.matches.find(
      (match) => match.round === 'semifinal' && match.pair_a_id !== null,
    )
    if (!semifinal) throw new Error('Knockout stage has no playable semifinal')
    expect((await rpc('start_scoring', mutation(semifinal.version, { matchId: semifinal.id }), staff)).ok).toBe(true)

    const groupMatch = knockouts.snapshot?.matches.find((match) => match.round === 'group' && match.state === 'completed')
    if (!groupMatch) throw new Error('No completed group match to correct')

    // Same winner, different score: the UI once claimed this stays allowed.
    const sameWinner = await (await previewCorrection(groupMatch.id, { a: 21, b: 19 }, staff)).json() as Impact
    expect(sameWinner.blockedReason).toBe('knockouts-started')
    expect(sameWinner.after).toBeNull()

    const swappedWinner = await (await previewCorrection(groupMatch.id, { a: 10, b: 21 }, staff)).json() as Impact
    expect(swappedWinner.blockedReason).toBe('knockouts-started')

    const current = await state(staff)
    const rejected = await rpc('correct_result', mutation(groupMatch.version, {
      matchId: groupMatch.id,
      score: { a: 21, b: 19 },
      previewTournamentVersion: current.snapshot?.tournament.result_revision,
    }), staff)
    expect(rejected.ok).toBe(false)
    // A reviewed version is supplied, so this can only be the knockout block.
    expect((await rejected.json() as { message?: string }).message)
      .toContain('Knockout play already depends on group participants')
  })

  it('reports the tie confirmations a correction would invalidate', async () => {
    const staff = await signInAnonymously()
    await elevate(staff)
    await createTournament(staff)
    const completed = await completeGroupStage(staff)
    const groupA = completed.pairs.filter((pair) => pair.group_code === 'A').map((pair) => pair.id)
    expect((await rpc('resolve_tie', mutation(completed.tournament.version, {
      group: 'A',
      orderedPairIds: groupA,
      explanation: 'Organizer decision',
    }), staff)).ok).toBe(true)

    const resolved = await state(staff)
    expect(resolved.snapshot?.tieResolutions.length).toBe(1)
    const groupMatch = resolved.snapshot?.matches.find(
      (match) => match.round === 'group' && match.state === 'completed',
    )
    if (!groupMatch) throw new Error('No completed group match to correct')

    const impact = await (await previewCorrection(groupMatch.id, { a: 10, b: 21 }, staff)).json() as Impact
    expect(impact.blockedReason).toBeNull()
    expect(impact.after?.tieResolutions).toEqual([])
  })

  it('previews a withdrawal and refuses one that would leave a group too small', async () => {
    const staff = await signInAnonymously()
    await elevate(staff)
    const created = await createTournament(staff)
    const groupA = created.pairs.filter((pair) => pair.group_code === 'A')
    expect(groupA.length).toBe(2)

    const blocked = await (await previewWithdrawal(groupA[0].id, staff)).json() as Impact
    expect(blocked.blockedReason).toBe('too-few-active-pairs')
    expect(blocked.after).toBeNull()

    const current = await state(staff)
    expect((await rpc('withdraw_pair', mutation(current.snapshot?.tournament.version ?? -1, {
      pairId: groupA[0].id,
      previewTournamentVersion: current.snapshot?.tournament.result_revision,
    }), staff)).ok).toBe(false)
  })

  it('voids a withdrawn pair\'s group matches in the projection', async () => {
    const staff = await signInAnonymously()
    await elevate(staff)
    const created = await createTournament(staff, 6)
    const target = created.pairs.find((pair) => pair.group_code === 'A')
    if (!target) throw new Error('Fixture has no group A pair')

    const impact = await (await previewWithdrawal(target.id, staff)).json() as Impact
    expect(impact.blockedReason).toBeNull()
    expect(impact.after?.pairs.find((pair) => pair.id === target.id)?.withdrawn).toBe(true)
    const voided = impact.after?.matches.filter(
      (match) => match.round === 'group' && [match.pair_a_id, match.pair_b_id].includes(target.id),
    )
    expect(voided?.length).toBeGreaterThan(0)
    expect(voided?.every((match) => match.state === 'void')).toBe(true)
    expect(await state(staff)).toEqual({ resetGeneration: 0, snapshot: created })
  })

  it('blocks withdrawal once knockout play starts', async () => {
    const staff = await signInAnonymously()
    await elevate(staff)
    const created = await createTournament(staff, 6)
    const completed = await completeGroupStage(staff)
    expect((await rpc('confirm_groups', mutation(completed.tournament.version, {}), staff)).ok).toBe(true)

    const knockouts = await state(staff)
    const semifinal = knockouts.snapshot?.matches.find(
      (match) => match.round === 'semifinal' && match.pair_a_id !== null,
    )
    if (!semifinal) throw new Error('Knockout stage has no playable semifinal')
    expect((await rpc('start_scoring', mutation(semifinal.version, { matchId: semifinal.id }), staff)).ok).toBe(true)

    const impact = await (await previewWithdrawal(created.pairs[0].id, staff)).json() as Impact
    expect(impact.blockedReason).toBe('knockouts-started')
  })

  it('keeps a reviewed preview valid while a live match is being scored', async () => {
    const staff = await signInAnonymously()
    await elevate(staff)
    const created = await createTournament(staff, 6)
    const target = created.matches.find(
      (candidate) => candidate.round === 'group' && candidate.pair_a_id !== null,
    )
    const scoring = created.matches.find(
      (candidate) => candidate.round === 'group' && candidate.pair_a_id !== null && candidate.id !== target?.id,
    )
    if (!target || !scoring) throw new Error('Fixture needs two independent group matches')

    expect((await rpc('start_scoring', mutation(scoring.version, { matchId: scoring.id }), staff)).ok).toBe(true)

    const reviewed = await (await previewCorrection(target.id, { a: 21, b: 10 }, staff)).json() as Impact
    expect(reviewed.blockedReason).toBeNull()

    // Points on another court move public.tournament.version but must not
    // invalidate a projection that does not depend on them.
    let playing = (await state(staff)).snapshot?.matches.find((match) => match.id === scoring.id)
    for (let point = 0; point < 3; point += 1) {
      if (!playing) throw new Error('Scoring match vanished')
      expect((await rpc('add_point', mutation(playing.version, {
        matchId: scoring.id,
        side: 'a',
      }), staff)).ok).toBe(true)
      playing = (await state(staff)).snapshot?.matches.find((match) => match.id === scoring.id)
    }

    const moved = await state(staff)
    expect(moved.snapshot?.tournament.version).toBeGreaterThan(created.tournament.version)
    expect(moved.snapshot?.tournament.result_revision).toBe(reviewed.tournamentVersion)

    const saved = await rpc('enter_result', mutation(target.version, {
      matchId: target.id,
      score: { a: 21, b: 10 },
    }), staff)
    expect(saved.ok).toBe(true)
  })

  it('invalidates a reviewed preview when another result lands', async () => {
    const staff = await signInAnonymously()
    await elevate(staff)
    const created = await createTournament(staff, 6)
    const target = created.pairs.find((pair) => pair.group_code === 'A')
    const other = created.matches.find(
      (match) => match.round === 'group' && match.pair_a_id !== null
        && ![match.pair_a_id, match.pair_b_id].includes(target?.id ?? ''),
    )
    if (!target || !other) throw new Error('Fixture is missing an independent match')

    const reviewed = await (await previewWithdrawal(target.id, staff)).json() as Impact
    expect((await rpc('enter_result', mutation(other.version, {
      matchId: other.id,
      score: { a: 21, b: 10 },
    }), staff)).ok).toBe(true)

    const moved = await state(staff)
    expect(moved.snapshot?.tournament.result_revision).toBeGreaterThan(reviewed.tournamentVersion)
    expect((await rpc('withdraw_pair', mutation(moved.snapshot?.tournament.version ?? -1, {
      pairId: target.id,
      previewTournamentVersion: reviewed.tournamentVersion,
    }), staff)).ok).toBe(false)
  })

  it('rejects a confirmation built on a superseded preview', async () => {
    const staff = await signInAnonymously()
    await elevate(staff)
    const created = await createTournament(staff, 6)
    const target = created.pairs.find((pair) => pair.group_code === 'A')
    const other = created.matches.find(
      (match) => match.round === 'group' && match.pair_a_id !== null
        && ![match.pair_a_id, match.pair_b_id].includes(target?.id ?? ''),
    )
    if (!target || !other) throw new Error('Fixture is missing an independent match')

    const stale = await (await previewWithdrawal(target.id, staff)).json() as Impact
    expect(stale.blockedReason).toBeNull()

    // Unrelated play lands between the review and the confirmation.
    expect((await rpc('enter_result', mutation(other.version, {
      matchId: other.id,
      score: { a: 21, b: 10 },
    }), staff)).ok).toBe(true)

    const moved = await state(staff)
    expect((await rpc('withdraw_pair', mutation(moved.snapshot?.tournament.version ?? -1, {
      pairId: target.id,
      previewTournamentVersion: stale.tournamentVersion,
    }), staff)).ok).toBe(false)

    expect((await rpc('withdraw_pair', mutation(moved.snapshot?.tournament.version ?? -1, {
      pairId: target.id,
      previewTournamentVersion: moved.snapshot?.tournament.result_revision,
    }), staff)).ok).toBe(true)
  })

  it('refuses a correction or withdrawal that carries no reviewed version', async () => {
    const staff = await signInAnonymously()
    await elevate(staff)
    const created = await createTournament(staff, 6)
    const match = created.matches.find((candidate) => candidate.pair_a_id !== null)
    const target = created.pairs.find((pair) => pair.group_code === 'A')
    if (!match || !target) throw new Error('Fixture is incomplete')

    expect((await rpc('enter_result', mutation(match.version, {
      matchId: match.id,
      score: { a: 21, b: 10 },
    }), staff)).ok).toBe(true)

    const current = await state(staff)
    const corrected = current.snapshot?.matches.find((candidate) => candidate.id === match.id)
    expect((await rpc('correct_result', mutation(corrected?.version ?? -1, {
      matchId: match.id,
      score: { a: 21, b: 15 },
    }), staff)).ok).toBe(false)

    expect((await rpc('withdraw_pair', mutation(current.snapshot?.tournament.version ?? -1, {
      pairId: target.id,
    }), staff)).ok).toBe(false)
  })

  it('rejects a preview that observed an older reset generation', async () => {
    const staff = await signInAnonymously()
    await elevate(staff)
    const created = await createTournament(staff)
    const match = created.matches.find((candidate) => candidate.pair_a_id !== null)
    if (!match) throw new Error('Fixture has no playable match')

    expect((await previewCorrection(match.id, { a: 21, b: 10 }, staff, 99)).ok).toBe(false)
    expect((await previewWithdrawal(created.pairs[0].id, staff, 99)).ok).toBe(false)
  })
})
