import type { FixtureStage, Score, Side, UUID } from '../../domain/types'
import { isGameWon } from '../../domain/scoring'

/** The score is always the open game's; confirmed games are history. */
interface ScoringContext {
  readonly matchId: UUID
  readonly stage: FixtureStage
  readonly resetGeneration: number
  readonly gameNumber: number
  readonly score: Score
  readonly matchVersion: number
  readonly hasOwnership: boolean
}

export interface IdleScoringState extends ScoringContext {
  readonly status: 'idle'
}

export interface PendingPoint {
  readonly requestId: UUID
  readonly resetGeneration: number
  readonly side: Side
  readonly expectedVersion: number
  readonly previousScore: Score
}

export interface AuthoritativeObservation {
  readonly resetGeneration: number
  readonly gameNumber: number
  readonly score: Score
  readonly matchVersion: number
  readonly hasOwnership: boolean
}

export interface SavingScoringState extends ScoringContext {
  readonly status: 'saving'
  readonly pending: PendingPoint
  readonly observed: AuthoritativeObservation | null
}

export type SaveFailureReason = 'network' | 'version-conflict' | 'ownership-conflict' | 'server'

export interface FailedScoringState extends ScoringContext {
  readonly status: 'failed'
  readonly pending: PendingPoint
  readonly observed: AuthoritativeObservation | null
  readonly reason: SaveFailureReason
  readonly message: string
}

export interface ReviewingScoringState extends ScoringContext {
  readonly status: 'reviewing'
  readonly winningSide: Side
}

export type ScoringState =
  | IdleScoringState
  | SavingScoringState
  | FailedScoringState
  | ReviewingScoringState

export type ScoringEvent =
  | { readonly type: 'point-requested'; readonly side: Side; readonly requestId: UUID }
  | { readonly type: 'point-acknowledged'; readonly requestId: UUID; readonly resetGeneration: number; readonly matchVersion: number }
  | {
      readonly type: 'point-failed'
      readonly requestId: UUID
      readonly resetGeneration: number
      readonly reason: SaveFailureReason
      readonly message: string
    }
  | { readonly type: 'retry-requested' }
  | {
      readonly type: 'ownership-recovered'
      readonly resetGeneration: number
      readonly gameNumber: number
      readonly score: Score
      readonly matchVersion: number
    }
  | {
      readonly type: 'snapshot-received'
      readonly resetGeneration: number
      readonly gameNumber: number
      readonly score: Score
      readonly matchVersion: number
      readonly hasOwnership: boolean
    }
  | { readonly type: 'review-dismissed' }
  | { readonly type: 'game-confirmed'; readonly resetGeneration: number; readonly gameNumber: number; readonly matchVersion: number }
  | { readonly type: 'version-conflict-reconciled' }

function addPoint(score: Score, side: Side): Score {
  return side === 'a'
    ? { a: score.a + 1, b: score.b }
    : { a: score.a, b: score.b + 1 }
}

function winningSide(score: Score): Side {
  return score.a > score.b ? 'a' : 'b'
}

function settle(context: ScoringContext): IdleScoringState | ReviewingScoringState {
  if (isGameWon(context.score, context.stage)) {
    return { ...context, status: 'reviewing', winningSide: winningSide(context.score) }
  }
  return { ...context, status: 'idle' }
}

function settlePoint(state: SavingScoringState, matchVersion: number): ScoringState {
  const observation = state.observed !== null && state.observed.matchVersion >= matchVersion
    ? state.observed
    : null
  return settle(observation === null
    ? {
        matchId: state.matchId,
        stage: state.stage,
        resetGeneration: state.resetGeneration,
        gameNumber: state.gameNumber,
        score: state.score,
        matchVersion,
        hasOwnership: state.hasOwnership,
      }
    : { matchId: state.matchId, stage: state.stage, ...observation })
}

function restoreSnapshot(
  state: ScoringState,
  event: Extract<ScoringEvent, { type: 'snapshot-received' }>,
): ScoringState {
  if (event.resetGeneration < state.resetGeneration) return state
  if (event.resetGeneration > state.resetGeneration) {
    return settle({
      matchId: state.matchId,
      stage: state.stage,
      resetGeneration: event.resetGeneration,
      gameNumber: event.gameNumber,
      score: event.score,
      matchVersion: event.matchVersion,
      hasOwnership: false,
    })
  }
  if (event.matchVersion < state.matchVersion) return state
  if (state.status === 'saving' || state.status === 'failed') {
    if (state.observed !== null && event.matchVersion < state.observed.matchVersion) return state
    return {
      ...state,
      observed: {
        resetGeneration: event.resetGeneration,
        gameNumber: event.gameNumber,
        score: event.score,
        matchVersion: event.matchVersion,
        hasOwnership: event.hasOwnership,
      },
    }
  }

  return settle({
    matchId: state.matchId,
    stage: state.stage,
    resetGeneration: event.resetGeneration,
    gameNumber: event.gameNumber,
    score: event.score,
    matchVersion: event.matchVersion,
    hasOwnership: event.hasOwnership,
  })
}

export function reduceScoring(state: ScoringState, event: ScoringEvent): ScoringState {
  switch (event.type) {
    case 'point-requested': {
      if (state.status !== 'idle' || !state.hasOwnership || isGameWon(state.score, state.stage)) return state
      return {
        ...state,
        status: 'saving',
        score: addPoint(state.score, event.side),
        pending: {
          requestId: event.requestId,
          resetGeneration: state.resetGeneration,
          side: event.side,
          expectedVersion: state.matchVersion,
          previousScore: state.score,
        },
        observed: null,
      }
    }
    case 'point-acknowledged': {
      if (state.status !== 'saving' || state.pending.requestId !== event.requestId || state.pending.resetGeneration !== event.resetGeneration) return state
      return settlePoint(state, event.matchVersion)
    }
    case 'point-failed': {
      if (state.status !== 'saving' || state.pending.requestId !== event.requestId || state.pending.resetGeneration !== event.resetGeneration) return state
      return {
        ...state,
        status: 'failed',
        hasOwnership: event.reason === 'ownership-conflict' ? false : state.hasOwnership,
        reason: event.reason,
        message: event.message,
      }
    }
    case 'retry-requested': {
      if (state.status !== 'failed') return state
      if (state.reason === 'version-conflict') return state
      if (state.reason === 'ownership-conflict' && !state.hasOwnership) return state
      const { reason: _reason, message: _message, ...retryState } = state
      return { ...retryState, status: 'saving' }
    }
    case 'ownership-recovered': {
      if (event.resetGeneration !== state.resetGeneration) return state
      const observation: AuthoritativeObservation = {
        resetGeneration: event.resetGeneration,
        gameNumber: event.gameNumber,
        score: event.score,
        matchVersion: event.matchVersion,
        hasOwnership: true,
      }
      if (state.status === 'idle' || state.status === 'reviewing') {
        if (event.matchVersion < state.matchVersion) return state
        return settle({ matchId: state.matchId, stage: state.stage, ...observation })
      }
      if (state.status !== 'failed') return state
      if (event.matchVersion < state.matchVersion) return state
      if (state.observed !== null && event.matchVersion < state.observed.matchVersion) return state
      return {
        ...state,
        hasOwnership: true,
        matchVersion: event.matchVersion,
        observed: state.observed?.matchVersion === event.matchVersion
          ? { ...state.observed, hasOwnership: true }
          : observation,
      }
    }
    case 'snapshot-received':
      return restoreSnapshot(state, event)
    case 'review-dismissed': {
      if (state.status !== 'reviewing') return state
      const { winningSide: _winningSide, ...idleState } = state
      return { ...idleState, status: 'idle' }
    }
    case 'game-confirmed': {
      // The server opened the next game at 0–0; a snapshot already past this
      // version has said so, and more, first.
      if (state.status !== 'reviewing' && state.status !== 'idle') return state
      if (event.resetGeneration !== state.resetGeneration || event.matchVersion <= state.matchVersion) return state
      return {
        matchId: state.matchId,
        stage: state.stage,
        resetGeneration: state.resetGeneration,
        gameNumber: event.gameNumber,
        score: { a: 0, b: 0 },
        matchVersion: event.matchVersion,
        hasOwnership: state.hasOwnership,
        status: 'idle',
      }
    }
    case 'version-conflict-reconciled': {
      if (state.status !== 'failed' || state.reason !== 'version-conflict' || state.observed === null) return state
      return settle({ matchId: state.matchId, stage: state.stage, ...state.observed })
    }
  }
}
