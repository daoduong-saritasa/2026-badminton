import { useEffect, useReducer, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, RefreshCw, RotateCcw, ShieldAlert } from 'lucide-react'

import { canScore } from '@/data/staff'
import { fetchTournament, mutateTournament } from '@/data/tournament'
import { isWinningScore } from '@/domain/scoring'
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

function failureReason(error: unknown): SaveFailureReason {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if (error.code === '40001') return 'version-conflict'
    if (error.code === '42501') return 'ownership-conflict'
  }
  if (error instanceof TypeError) return 'network'
  return 'server'
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'The score could not be saved'
}

function playableMatches(snapshot: TournamentSnapshot): PlayingMatch[] {
  return snapshot.matches.filter((match): match is PlayingMatch => match.state === 'playing')
}

function pairSeedLabel(snapshot: TournamentSnapshot, pairId: UUID | null): string {
  const pair = snapshot.pairs.find((candidate) => candidate.id === pairId)
  if (!pair) return 'Qualifier'
  const firstSeed = snapshot.players.find((player) => player.id === pair.playerAId)?.seed
  const secondSeed = snapshot.players.find((player) => player.id === pair.playerBId)?.seed
  return firstSeed && secondSeed ? `Seeds ${firstSeed} + ${secondSeed}` : 'Seeds unavailable'
}

function createInitialState(match: PlayingMatch, hasOwnership: boolean): IdleScoringState {
  return {
    status: 'idle',
    matchId: match.id,
    score: match.score,
    matchVersion: match.version,
    hasOwnership,
  }
}

async function latestMatch(matchId: string): Promise<PlayingMatch> {
  const snapshot = await fetchTournament()
  const match = snapshot.matches.find((candidate): candidate is PlayingMatch => candidate.id === matchId && candidate.state === 'playing')
  if (!match) throw new Error('The selected match is no longer available for scoring')
  return match
}

function ScoringSurface({
  match,
  snapshot,
  ownership,
  onExit,
}: {
  match: PlayingMatch
  snapshot: TournamentSnapshot
  ownership: boolean
  onExit: () => void
}) {
  const queryClient = useQueryClient()
  const [state, dispatch] = useReducer(reduceScoring, createInitialState(match, ownership))
  const [takeoverOpen, setTakeoverOpen] = useState(false)

  useEffect(() => {
    dispatch({
      type: 'snapshot-received',
      score: match.score,
      matchVersion: match.version,
      hasOwnership: ownership,
    })
  }, [match.score, match.version, ownership])

  const runPoint = async (pending: PendingPoint) => {
    try {
      const receipt = await mutateTournament('add_point', {
        requestId: pending.requestId,
        expectedVersion: pending.expectedVersion,
        payload: { matchId: match.id, side: pending.side },
      })
      dispatch({
        type: 'point-acknowledged',
        requestId: pending.requestId,
        matchVersion: receipt.matchVersion ?? pending.expectedVersion + 1,
      })
      await queryClient.invalidateQueries({ queryKey: ['tournament'] })
    } catch (error) {
      const reason = failureReason(error)
      dispatch({
        type: 'point-failed',
        requestId: pending.requestId,
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

  const takeoverMutation = useMutation({
    mutationFn: async () => {
      await mutateTournament('take_over', {
        requestId: crypto.randomUUID(),
        expectedVersion: match.version,
        payload: { matchId: match.id },
      })
      const latest = await latestMatch(match.id)
      const hasOwnership = await canScore(match.id)
      return { latest, hasOwnership }
    },
    onSuccess: ({ latest, hasOwnership }) => {
      queryClient.setQueryData(['score-access', match.id], hasOwnership)
      if (hasOwnership) {
        dispatch({ type: 'ownership-recovered', score: latest.score, matchVersion: latest.version })
      } else {
        dispatch({ type: 'snapshot-received', score: latest.score, matchVersion: latest.version, hasOwnership: false })
      }
      setTakeoverOpen(false)
    },
  })

  const undoMutation = useMutation({
    mutationFn: () => mutateTournament('undo_point', {
      requestId: crypto.randomUUID(),
      expectedVersion: state.matchVersion,
      payload: { matchId: match.id },
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tournament'] }),
  })

  const confirmMutation = useMutation({
    mutationFn: () => mutateTournament('confirm_result', {
      requestId: crypto.randomUUID(),
      expectedVersion: state.matchVersion,
      payload: { matchId: match.id },
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tournament'] }),
  })

  const failed = state.status === 'failed' ? state : null
  const needsTakeover = !state.hasOwnership || failed?.reason === 'ownership-conflict'
  const disabled = state.status !== 'idle' || !state.hasOwnership || isWinningScore(state.score)

  return (
    <main className="score-viewport grid grid-rows-[2.75rem_minmax(0,1fr)_auto] gap-2 overflow-hidden bg-background">
      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" size="sm" className="rounded-full bg-white" onClick={onExit}>
          <ArrowLeft /> Back
        </Button>
        <div className="flex items-center gap-2 rounded-full border bg-white p-1 shadow-sm">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full"
            disabled={undoMutation.isPending || state.status === 'saving' || state.status === 'failed' || !state.hasOwnership}
            onClick={() => undoMutation.mutate()}
          >
            <RotateCcw /> Undo
          </Button>
          <Button
            size="sm"
            className="rounded-full"
            disabled={state.status !== 'reviewing' || confirmMutation.isPending}
            onClick={() => confirmMutation.mutate()}
          >
            Confirm
          </Button>
        </div>
        <span className="hidden text-xs font-semibold sm:block">Court {match.court ?? '–'}</span>
      </div>

      <div className="grid min-h-0 grid-cols-2 gap-2">
        {(['a', 'b'] as const).map((side) => (
          <button
            type="button"
            key={side}
            className={side === 'a'
              ? 'grid min-h-0 touch-manipulation select-none grid-rows-[auto_1fr_auto] place-items-center rounded-[1.75rem] border border-[#bed0e2] bg-[#e5ecf3] p-4 text-primary'
              : 'grid min-h-0 touch-manipulation select-none grid-rows-[auto_1fr_auto] place-items-center rounded-[1.75rem] border border-[#f7c1ad] bg-[#fcdfd4] p-4'}
            disabled={disabled}
            aria-label={`Add one point for ${pairName(snapshot, side === 'a' ? match.pairAId : match.pairBId)}`}
            onClick={() => handlePoint(side)}
          >
            <span className="max-w-full truncate text-[clamp(0.75rem,2.5vw,1.5rem)] font-semibold">
              {pairName(snapshot, side === 'a' ? match.pairAId : match.pairBId)}
            </span>
            <strong className="numeric self-center pr-[0.07em] text-[clamp(5rem,28dvh,16rem)] font-bold leading-none tracking-[-0.08em]">
              {state.score[side]}
            </strong>
            <small className="text-[0.625rem] opacity-70">
              {pairSeedLabel(snapshot, side === 'a' ? match.pairAId : match.pairBId)}
            </small>
          </button>
        ))}
      </div>

      <div className="min-h-8 text-center text-xs" aria-live="polite">
        {state.status === 'saving' ? 'Saving point…' : null}
        {failed ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="text-destructive">{failed.message}</span>
            {failed.reason === 'version-conflict' && failed.observed ? (
              <Button size="sm" variant="outline" onClick={() => dispatch({ type: 'version-conflict-reconciled' })}>
                Use latest score
              </Button>
            ) : null}
            {!needsTakeover ? (
              <Button size="sm" variant="outline" onClick={handleRetry}><RefreshCw /> Retry</Button>
            ) : null}
          </div>
        ) : null}
        {needsTakeover ? (
          <Button size="sm" variant="outline" className="rounded-full" onClick={() => setTakeoverOpen(true)}>
            <ShieldAlert /> Take over scoring
          </Button>
        ) : null}
      </div>

      <AlertDialog open={state.status === 'reviewing'} onOpenChange={(open) => {
        if (!open) dispatch({ type: 'review-dismissed' })
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm the winning score?</AlertDialogTitle>
            <AlertDialogDescription>
              Review {state.score.a}–{state.score.b}. Dismiss this message if you need to undo the last point.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Review and undo</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmMutation.mutate()}>Confirm result</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={takeoverOpen} onOpenChange={setTakeoverOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Take over this match?</AlertDialogTitle>
            <AlertDialogDescription>The previous scorer will immediately lose write access.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => takeoverMutation.mutate()}>
              {takeoverMutation.isPending ? 'Taking over…' : 'Take over'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}

export function ScoreTracker({ snapshot, onExit }: { snapshot: TournamentSnapshot; onExit: () => void }) {
  const matches = playableMatches(snapshot)
  const [matchId, setMatchId] = useState(matches[0]?.id ?? '')
  const match = matches.find((candidate) => candidate.id === matchId) ?? matches[0]
  const ownershipQuery = useQuery({
    queryKey: ['score-access', match?.id],
    queryFn: () => canScore(match?.id ?? ''),
    enabled: match !== undefined,
    refetchInterval: 5_000,
  })

  if (!match) {
    return (
      <main className="score-viewport grid place-items-center text-center">
        <div>
          <h2 className="text-xl font-semibold">No match is currently scoring</h2>
          <Button className="mt-4 rounded-full" variant="outline" onClick={onExit}>Back to matches</Button>
        </div>
      </main>
    )
  }

  if (ownershipQuery.isPending) {
    return <main className="score-viewport grid place-items-center text-sm">Recovering score access…</main>
  }

  return (
    <div>
      {matches.length > 1 ? (
        <Select value={match.id} onValueChange={setMatchId}>
          <SelectTrigger className="fixed right-4 top-4 z-20 w-36 rounded-full bg-white">
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
        key={match.id}
        match={match}
        snapshot={snapshot}
        ownership={ownershipQuery.data ?? false}
        onExit={onExit}
      />
    </div>
  )
}
