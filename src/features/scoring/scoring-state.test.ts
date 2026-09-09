import { describe, expect, it } from 'vitest'

import { reduceScoring, type IdleScoringState, type ScoringState } from './scoring-state'

const requestId = '00000000-0000-4000-8000-000000000001'

function idle(overrides: Partial<IdleScoringState> = {}): IdleScoringState {
  return {
    status: 'idle',
    matchId: '00000000-0000-4000-8000-000000000002',
    score: { a: 10, b: 10 },
    matchVersion: 7,
    hasOwnership: true,
    ...overrides,
  }
}

describe('reduceScoring', () => {
  it('allows one pending point and preserves its request identity through retry', () => {
    const saving = reduceScoring(idle(), { type: 'point-requested', side: 'a', requestId })
    expect(saving).toMatchObject({
      status: 'saving',
      score: { a: 11, b: 10 },
      pending: { requestId, side: 'a', expectedVersion: 7 },
    })
    expect(
      reduceScoring(saving, {
        type: 'point-requested',
        side: 'b',
        requestId: '00000000-0000-4000-8000-000000000003',
      }),
    ).toBe(saving)

    const failed = reduceScoring(saving, {
      type: 'point-failed',
      requestId,
      reason: 'network',
      message: 'Connection lost',
    })
    const retried = reduceScoring(failed, { type: 'retry-requested' })
    expect(retried).toMatchObject({
      status: 'saving',
      pending: { requestId, expectedVersion: 7 },
    })
  })

  it('ignores duplicate and mismatched acknowledgements', () => {
    const saving = reduceScoring(idle(), { type: 'point-requested', side: 'a', requestId })
    const mismatch = reduceScoring(saving, {
      type: 'point-acknowledged',
      requestId: '00000000-0000-4000-8000-000000000003',
      matchVersion: 8,
    })
    expect(mismatch).toBe(saving)

    const acknowledged = reduceScoring(saving, {
      type: 'point-acknowledged',
      requestId,
      matchVersion: 8,
    })
    expect(acknowledged).toMatchObject({ status: 'idle', score: { a: 11, b: 10 }, matchVersion: 8 })
    expect(
      reduceScoring(acknowledged, { type: 'point-acknowledged', requestId, matchVersion: 8 }),
    ).toBe(acknowledged)
  })

  it('reviews a winning point, dismisses it, and accepts a newer undo snapshot', () => {
    const saving = reduceScoring(idle({ score: { a: 20, b: 19 } }), {
      type: 'point-requested',
      side: 'a',
      requestId,
    })
    const reviewing = reduceScoring(saving, {
      type: 'point-acknowledged',
      requestId,
      matchVersion: 8,
    })
    expect(reviewing).toMatchObject({ status: 'reviewing', winningSide: 'a', score: { a: 21, b: 19 } })

    const dismissed = reduceScoring(reviewing, { type: 'review-dismissed' })
    expect(dismissed).toMatchObject({ status: 'idle', score: { a: 21, b: 19 } })
    const undone = reduceScoring(dismissed, {
      type: 'snapshot-received',
      score: { a: 20, b: 19 },
      matchVersion: 9,
      hasOwnership: true,
    })
    expect(undone).toMatchObject({ status: 'idle', score: { a: 20, b: 19 }, matchVersion: 9 })
  })

  it('requires explicit ownership recovery before retrying the same point', () => {
    const saving = reduceScoring(idle(), { type: 'point-requested', side: 'b', requestId })
    const conflicted = reduceScoring(saving, {
      type: 'point-failed',
      requestId,
      reason: 'ownership-conflict',
      message: 'Another scorer owns this match',
    })
    expect(conflicted).toMatchObject({ status: 'failed', hasOwnership: false, pending: { requestId } })
    expect(reduceScoring(conflicted, { type: 'retry-requested' })).toBe(conflicted)

    const recovered = reduceScoring(conflicted, {
      type: 'ownership-recovered',
      score: { a: 12, b: 10 },
      matchVersion: 12,
    })
    const retried = reduceScoring(recovered, { type: 'retry-requested' })
    expect(retried).toMatchObject({
      status: 'saving',
      hasOwnership: true,
      matchVersion: 12,
      pending: { requestId, expectedVersion: 7 },
    })

    const acknowledged = reduceScoring(retried, {
      type: 'point-acknowledged',
      requestId,
      matchVersion: 8,
    })
    expect(acknowledged).toMatchObject({
      status: 'idle',
      score: { a: 12, b: 10 },
      matchVersion: 12,
      hasOwnership: true,
    })
  })

  it('reconciles a version conflict before issuing a replacement request', () => {
    const saving = reduceScoring(idle(), { type: 'point-requested', side: 'a', requestId })
    const observed = reduceScoring(saving, {
      type: 'snapshot-received',
      score: { a: 10, b: 11 },
      matchVersion: 8,
      hasOwnership: false,
    })
    const conflicted = reduceScoring(observed, {
      type: 'point-failed',
      requestId,
      reason: 'version-conflict',
      message: 'Match changed',
    })
    expect(reduceScoring(conflicted, { type: 'retry-requested' })).toBe(conflicted)

    const reconciled = reduceScoring(conflicted, { type: 'version-conflict-reconciled' })
    expect(reconciled).toMatchObject({
      status: 'idle',
      score: { a: 10, b: 11 },
      matchVersion: 8,
      hasOwnership: false,
    })
    expect(
      reduceScoring(reconciled, {
        type: 'point-requested',
        side: 'a',
        requestId: '00000000-0000-4000-8000-000000000004',
      }),
    ).toBe(reconciled)

    const recovered = reduceScoring(reconciled, {
      type: 'ownership-recovered',
      score: { a: 10, b: 11 },
      matchVersion: 9,
    })
    const replacement = reduceScoring(recovered, {
      type: 'point-requested',
      side: 'a',
      requestId: '00000000-0000-4000-8000-000000000004',
    })
    expect(replacement).toMatchObject({
      status: 'saving',
      pending: {
        requestId: '00000000-0000-4000-8000-000000000004',
        expectedVersion: 9,
      },
    })
  })

  it('retains a newer revoked snapshot until a delayed acknowledgement settles', () => {
    const saving = reduceScoring(idle(), { type: 'point-requested', side: 'a', requestId })
    const observed = reduceScoring(saving, {
      type: 'snapshot-received',
      score: { a: 12, b: 10 },
      matchVersion: 10,
      hasOwnership: false,
    })
    expect(observed).toMatchObject({
      status: 'saving',
      observed: { score: { a: 12, b: 10 }, matchVersion: 10, hasOwnership: false },
    })

    const acknowledged = reduceScoring(observed, {
      type: 'point-acknowledged',
      requestId,
      matchVersion: 8,
    })
    expect(acknowledged).toMatchObject({
      status: 'idle',
      score: { a: 12, b: 10 },
      matchVersion: 10,
      hasOwnership: false,
    })
  })

  it('accepts equal-version ownership recovery but not recovery older than a revocation', () => {
    const failed = reduceScoring(
      reduceScoring(idle(), { type: 'point-requested', side: 'a', requestId }),
      { type: 'point-failed', requestId, reason: 'ownership-conflict', message: 'taken over' },
    )
    const observed = reduceScoring(failed, {
      type: 'snapshot-received',
      score: { a: 10, b: 10 },
      matchVersion: 8,
      hasOwnership: false,
    })
    const recovered = reduceScoring(observed, {
      type: 'ownership-recovered',
      score: { a: 10, b: 10 },
      matchVersion: 8,
    })
    expect(recovered).toMatchObject({
      status: 'failed',
      hasOwnership: true,
      observed: { matchVersion: 8, hasOwnership: true },
    })

    const newerRevocation = reduceScoring(recovered, {
      type: 'snapshot-received',
      score: { a: 11, b: 10 },
      matchVersion: 9,
      hasOwnership: false,
    })
    expect(reduceScoring(newerRevocation, {
      type: 'ownership-recovered',
      score: { a: 10, b: 10 },
      matchVersion: 8,
    })).toBe(newerRevocation)
  })

  it('preserves equal-version revocation through acknowledgement', () => {
    const saving = reduceScoring(idle(), { type: 'point-requested', side: 'a', requestId })
    const ownedObservation = reduceScoring(saving, {
      type: 'snapshot-received',
      score: { a: 11, b: 10 },
      matchVersion: 8,
      hasOwnership: true,
    })
    const revokedObservation = reduceScoring(ownedObservation, {
      type: 'snapshot-received',
      score: { a: 11, b: 10 },
      matchVersion: 8,
      hasOwnership: false,
    })
    const acknowledged = reduceScoring(revokedObservation, {
      type: 'point-acknowledged',
      requestId,
      matchVersion: 8,
    })

    expect(acknowledged).toMatchObject({
      status: 'idle',
      score: { a: 11, b: 10 },
      matchVersion: 8,
      hasOwnership: false,
    })
  })

  it('rejects ownership recovery older than a retained revoked observation', () => {
    const saving = reduceScoring(idle(), { type: 'point-requested', side: 'a', requestId })
    const conflicted = reduceScoring(saving, {
      type: 'point-failed',
      requestId,
      reason: 'ownership-conflict',
      message: 'Another scorer owns this match',
    })
    const newerObservation = reduceScoring(conflicted, {
      type: 'snapshot-received',
      score: { a: 12, b: 10 },
      matchVersion: 13,
      hasOwnership: false,
    })
    const delayedRecovery = reduceScoring(newerObservation, {
      type: 'ownership-recovered',
      score: { a: 11, b: 10 },
      matchVersion: 12,
    })

    expect(delayedRecovery).toBe(newerObservation)
  })

  it('rejects stale snapshots and point entry after ownership revocation', () => {
    const current = idle({ matchVersion: 9 })
    expect(
      reduceScoring(current, {
        type: 'snapshot-received',
        score: { a: 3, b: 2 },
        matchVersion: 8,
        hasOwnership: true,
      }),
    ).toBe(current)

    const revoked = reduceScoring(current, {
      type: 'snapshot-received',
      score: current.score,
      matchVersion: 10,
      hasOwnership: false,
    })
    const attempted = reduceScoring(revoked, { type: 'point-requested', side: 'a', requestId })
    expect(attempted).toBe(revoked)
  })

  it('retains authoritative snapshots without replacing the pending mutation', () => {
    const saving: ScoringState = reduceScoring(idle(), {
      type: 'point-requested',
      side: 'a',
      requestId,
    })
    const snapshot = reduceScoring(saving, {
      type: 'snapshot-received',
      score: { a: 50, b: 50 },
      matchVersion: 50,
      hasOwnership: false,
    })
    expect(snapshot).toMatchObject({
      status: 'saving',
      pending: { requestId, expectedVersion: 7 },
      observed: {
        score: { a: 50, b: 50 },
        matchVersion: 50,
        hasOwnership: false,
      },
    })
  })
})
