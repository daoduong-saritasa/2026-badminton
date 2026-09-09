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
      matchVersion: 12,
    })
    const retried = reduceScoring(recovered, { type: 'retry-requested' })
    expect(retried).toMatchObject({
      status: 'saving',
      hasOwnership: true,
      matchVersion: 12,
      pending: { requestId, expectedVersion: 12 },
    })
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

  it('keeps pending state isolated from snapshots until its request settles', () => {
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
    expect(snapshot).toBe(saving)
  })
})
