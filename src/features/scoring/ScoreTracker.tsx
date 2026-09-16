import { useEffect, useReducer, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, RefreshCw, RotateCcw, ShieldAlert } from 'lucide-react'

import { canScore } from '@/data/staff'
import { fetchTournament, mutateTournament } from '@/data/tournament'
import { isWinningScore } from '@/domain/scoring'
import { availableCourts } from '@/domain/setup'
import type { PlayingMatch, Side, TournamentSnapshot, UUID } from '@/domain/types'
import {
  reduceScoring,
  type IdleScoringState,
  type PendingPoint,
  type SaveFailureReason,
} from './scoring-state'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { pairName } from '@/features/tournament/MatchTicket'
import { errorMessage } from '@/i18n/errors'
import { formatNumber } from '@/i18n/format'
import { messages } from '@/i18n/vi'
import { cn } from '@/lib/utils'

function failureReason(error: unknown): SaveFailureReason {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if (error.code === '40001') return 'version-conflict'
    if (error.code === '42501') return 'ownership-conflict'
  }
  if (error instanceof TypeError) return 'network'
  return 'server'
}

function message(error: unknown): string {
  return error === undefined || error === null ? messages.scoring.saveFailed : errorMessage(error)
}

function playableMatches(snapshot: TournamentSnapshot): PlayingMatch[] {
  const courts = new Set(availableCourts(snapshot.tournament.courtCount))
  return snapshot.matches.filter((match): match is PlayingMatch => match.state === 'playing' && match.court !== null && courts.has(match.court))
}

function pairSeedLabel(snapshot: TournamentSnapshot, pairId: UUID | null): string {
  const pair = snapshot.pairs.find((candidate) => candidate.id === pairId)
  if (!pair) return messages.scoring.qualifier
  const firstSeed = snapshot.players.find((player) => player.id === pair.playerAId)?.seed
  const secondSeed = snapshot.players.find((player) => player.id === pair.playerBId)?.seed
  return firstSeed && secondSeed ? messages.common.seeds(firstSeed, secondSeed) : messages.common.seedsUnavailable
}

function createInitialState(match: PlayingMatch, resetGeneration: number, hasOwnership: boolean): IdleScoringState {
  return {
    status: 'idle',
    matchId: match.id,
    resetGeneration,
    score: match.score,
    matchVersion: match.version,
    hasOwnership,
  }
}

async function latestMatch(matchId: string, resetGeneration: number): Promise<PlayingMatch> {
  const state = await fetchTournament()
  if (state.resetGeneration !== resetGeneration) throw new Error(messages.scoring.tournamentReset)
  const snapshot = state.snapshot
  if (snapshot === null) throw new Error(messages.scoring.tournamentReset)
  const match = snapshot.matches.find((candidate): candidate is PlayingMatch => candidate.id === matchId && candidate.state === 'playing')
  if (!match) throw new Error(messages.scoring.matchGone)
  return match
}

function ScoringSurface({
  match,
  snapshot,
  resetGeneration,
  ownership,
  onExit,
}: {
  match: PlayingMatch
  snapshot: TournamentSnapshot
  resetGeneration: number
  ownership: boolean
  onExit: () => void
}) {
  const queryClient = useQueryClient()
  const [state, dispatch] = useReducer(reduceScoring, createInitialState(match, resetGeneration, ownership))
  const [takeoverOpen, setTakeoverOpen] = useState(false)
  const [actionFailure, setActionFailure] = useState<string | null>(null)

  useEffect(() => {
    dispatch({
      type: 'snapshot-received',
      resetGeneration,
      score: match.score,
      matchVersion: match.version,
      hasOwnership: ownership,
    })
  }, [match.score, match.version, ownership, resetGeneration])

  const runPoint = async (pending: PendingPoint) => {
    try {
      const receipt = await mutateTournament('add_point', {
        requestId: pending.requestId,
        resetGeneration: pending.resetGeneration,
        expectedVersion: pending.expectedVersion,
        payload: { matchId: match.id, side: pending.side },
      })
      dispatch({
        type: 'point-acknowledged',
        requestId: pending.requestId,
        resetGeneration: pending.resetGeneration,
        matchVersion: receipt.matchVersion ?? pending.expectedVersion + 1,
      })
    } catch (error) {
      const reason = failureReason(error)
      dispatch({
        type: 'point-failed',
        requestId: pending.requestId,
        resetGeneration: pending.resetGeneration,
        reason,
        message: message(error),
      })
      if (reason === 'version-conflict' || reason === 'ownership-conflict') {
        await queryClient.invalidateQueries({ queryKey: ['tournament'] })
      }
    }
  }

  const handlePoint = (side: Side) => {
    if (state.status !== 'idle' || !state.hasOwnership || isWinningScore(state.score)) return
    const pending: PendingPoint = {
      requestId: crypto.randomUUID(),
      resetGeneration: state.resetGeneration,
      side,
      expectedVersion: state.matchVersion,
      previousScore: state.score,
    }
    dispatch({ type: 'point-requested', side, requestId: pending.requestId })
    void runPoint(pending)
  }

  const handleRetry = () => {
    if (state.status !== 'failed') return
    dispatch({ type: 'retry-requested' })
    void runPoint(state.pending)
  }

  const reconcileAfterAction = async (): Promise<void> => {
    const latestState = await fetchTournament()
    queryClient.setQueryData(['tournament'], latestState)
    const latest = latestState.snapshot?.matches.find(
      (candidate): candidate is PlayingMatch => candidate.id === match.id && candidate.state === 'playing',
    )
    if (!latest) return
    const hasOwnership = await canScore(match.id)
    queryClient.setQueryData(['score-access', latestState.resetGeneration, match.id], hasOwnership)
    dispatch({
      type: 'snapshot-received',
      resetGeneration: latestState.resetGeneration,
      score: latest.score,
      matchVersion: latest.version,
      hasOwnership,
    })
  }

  const handleActionFailure = async (action: string, error: unknown): Promise<void> => {
    try {
      await reconcileAfterAction()
      setActionFailure(messages.scoring.actionFailed(action, message(error)))
    } catch {
      setActionFailure(`${action} failed: ${message(error)}. The latest state could not be verified; leave and reopen scoring before continuing.`)
    }
  }

  const takeoverMutation = useMutation({
    onMutate: () => setActionFailure(null),
    mutationFn: async () => {
      await mutateTournament('take_over', {
        requestId: crypto.randomUUID(),
        resetGeneration,
        expectedVersion: match.version,
        payload: { matchId: match.id },
      })
      const latest = await latestMatch(match.id, resetGeneration)
      const hasOwnership = await canScore(match.id)
      return { latest, hasOwnership }
    },
    onSuccess: ({ latest, hasOwnership }) => {
      queryClient.setQueryData(['score-access', resetGeneration, match.id], hasOwnership)
      if (hasOwnership) {
        dispatch({ type: 'ownership-recovered', resetGeneration, score: latest.score, matchVersion: latest.version })
      } else {
        dispatch({ type: 'snapshot-received', resetGeneration, score: latest.score, matchVersion: latest.version, hasOwnership: false })
      }
      setTakeoverOpen(false)
    },
    onError: (error) => handleActionFailure(messages.scoring.actions.takeover, error),
  })

  const undoMutation = useMutation({
    onMutate: () => setActionFailure(null),
    mutationFn: () => mutateTournament('undo_point', {
      requestId: crypto.randomUUID(),
      resetGeneration,
      expectedVersion: state.matchVersion,
      payload: { matchId: match.id },
    }),
    onError: (error) => handleActionFailure(messages.scoring.actions.undo, error),
  })

  const confirmMutation = useMutation({
    onMutate: () => setActionFailure(null),
    mutationFn: () => mutateTournament('confirm_result', {
      requestId: crypto.randomUUID(),
      resetGeneration,
      expectedVersion: state.matchVersion,
      payload: { matchId: match.id },
    }),
    onError: (error) => handleActionFailure(messages.scoring.actions.confirm, error),
  })

  const failed = state.status === 'failed' ? state : null
  const needsTakeover = !state.hasOwnership || failed?.reason === 'ownership-conflict'
  const actionPending = takeoverMutation.isPending || undoMutation.isPending || confirmMutation.isPending
  const disabled = state.status !== 'idle' || !state.hasOwnership || isWinningScore(state.score) || actionPending

  return (
    <main className="score-viewport grid grid-rows-[2.75rem_minmax(0,1fr)_auto] gap-2 overflow-hidden bg-background">
      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" size="sm" onClick={onExit}>
          <ArrowLeft /> {messages.scoring.back}
        </Button>
        <div className="flex items-center gap-1 rounded-pill border border-line bg-white p-1 shadow-float">
          <Button
            variant="ghost"
            size="sm"
            className="min-w-22"
            disabled={actionPending || state.status === 'saving' || state.status === 'failed' || !state.hasOwnership}
            onClick={() => undoMutation.mutate()}
          >
            <RotateCcw /> {messages.scoring.undo}
          </Button>
          <Button
            size="sm"
            className="min-w-22"
            disabled={state.status !== 'reviewing' || actionPending}
            onClick={() => confirmMutation.mutate()}
          >
            {messages.scoring.confirm}
          </Button>
        </div>
        <span className="hidden text-xs font-semibold sm:block">{match.court ? messages.common.court(match.court) : '–'}</span>
      </div>

      <div className="grid min-h-0 grid-cols-2 gap-2">
        {(['a', 'b'] as const).map((side) => (
          <button
            type="button"
            key={side}
            className={cn(
              'grid min-h-0 touch-manipulation select-none grid-rows-[auto_1fr_auto] place-items-center rounded-[1.75rem] border px-4 pt-[1.375rem] pb-3.5 transition-colors disabled:cursor-default',
              side === 'a' ? 'border-navy-soft bg-mist text-navy' : 'border-peach-line bg-peach text-ink',
            )}
            disabled={disabled}
            aria-label={messages.scoring.addPoint(pairName(snapshot, side === 'a' ? match.pairAId : match.pairBId))}
            onClick={() => handlePoint(side)}
          >
            <span className="max-w-full [overflow-wrap:anywhere] text-[clamp(0.9375rem,2.4vw,1.625rem)]/[1.35] font-semibold tracking-[-0.023em]">
              {pairName(snapshot, side === 'a' ? match.pairAId : match.pairBId)}
            </span>
            <strong className="numeric self-center pr-[0.07em] text-[clamp(5rem,28dvh,16rem)] font-bold leading-none tracking-[-0.08em]">
              {formatNumber(state.score[side])}
            </strong>
            <small className="text-[0.625rem] opacity-75">
              {pairSeedLabel(snapshot, side === 'a' ? match.pairAId : match.pairBId)}
            </small>
          </button>
        ))}
      </div>

      <div className="min-h-8 self-center text-center text-[0.6875rem] text-navy" aria-live="polite">
        {state.status === 'saving' ? messages.scoring.savingPoint : null}
        {failed ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="text-destructive">{failed.message}</span>
            {failed.reason === 'version-conflict' && failed.observed ? (
              <Button size="sm" variant="outline" onClick={() => dispatch({ type: 'version-conflict-reconciled' })}>
                {messages.scoring.useLatestScore}
              </Button>
            ) : null}
            {!needsTakeover ? (
              <Button size="sm" variant="outline" onClick={handleRetry}><RefreshCw /> {messages.scoring.retry}</Button>
            ) : null}
          </div>
        ) : null}
        {needsTakeover ? (
          <Button size="sm" variant="outline" className="rounded-full" disabled={actionPending} onClick={() => setTakeoverOpen(true)}>
            <ShieldAlert /> {messages.scoring.takeOverScoring}
          </Button>
        ) : null}
        {actionFailure ? <p className="mt-1 text-destructive" role="alert">{actionFailure}</p> : null}
      </div>

      <AlertDialog open={state.status === 'reviewing'} onOpenChange={(open) => {
        if (!open) dispatch({ type: 'review-dismissed' })
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{messages.scoring.confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {messages.scoring.confirmBody(state.score.a, state.score.b)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{messages.scoring.reviewAndUndo}</AlertDialogCancel>
            <AlertDialogAction disabled={actionPending} onClick={() => confirmMutation.mutate()}>{messages.scoring.confirmResult}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={takeoverOpen} onOpenChange={setTakeoverOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{messages.scoring.takeoverTitle}</AlertDialogTitle>
            <AlertDialogDescription>{messages.scoring.takeoverBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{messages.common.cancel}</AlertDialogCancel>
            <AlertDialogAction disabled={actionPending} onClick={() => takeoverMutation.mutate()}>
              {takeoverMutation.isPending ? messages.scoring.takingOver : messages.scoring.takeOver}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}

export function ScoreTracker({ snapshot, resetGeneration, onExit }: { snapshot: TournamentSnapshot; resetGeneration: number; onExit: () => void }) {
  const matches = playableMatches(snapshot)
  const [matchId, setMatchId] = useState(matches[0]?.id ?? '')
  const match = matches.find((candidate) => candidate.id === matchId) ?? matches[0]
  const ownershipQuery = useQuery({
    queryKey: ['score-access', resetGeneration, match?.id],
    queryFn: () => canScore(match?.id ?? ''),
    enabled: match !== undefined,
    refetchInterval: 5_000,
  })

  if (!match) {
    return (
      <main className="score-viewport grid place-items-center text-center">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.028em]">{messages.scoring.noMatch}</h2>
          <Button className="mt-5" variant="outline" onClick={onExit}>{messages.scoring.backToMatches}</Button>
        </div>
      </main>
    )
  }

  if (ownershipQuery.isPending) {
    return <main className="score-viewport grid place-items-center text-sm">{messages.scoring.recovering}</main>
  }

  return (
    <div>
      {matches.length > 1 ? (
        <Select value={match.id} onValueChange={setMatchId}>
          <SelectTrigger size="sm" className="fixed right-4 top-4 z-20 w-32 rounded-pill">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {matches.map((candidate) => (
              <SelectItem value={candidate.id} key={candidate.id}>Court {candidate.court ?? '–'}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <ScoringSurface
        key={`${resetGeneration}-${match.id}`}
        match={match}
        snapshot={snapshot}
        resetGeneration={resetGeneration}
        ownership={ownershipQuery.data ?? false}
        onExit={onExit}
      />
    </div>
  )
}
