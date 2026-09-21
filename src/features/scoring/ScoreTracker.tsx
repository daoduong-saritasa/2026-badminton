import { useEffect, useReducer, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Play, RefreshCw, RotateCcw, ShieldAlert } from 'lucide-react'

import { canScore } from '@/data/staff'
import { fetchTournament, mutateTournament } from '@/data/tournament'
import { gamesToWinMatch, isGameWon, matchGameTally } from '@/domain/scoring'
import type { FixtureMatch, Game, Side, TournamentSnapshot, UUID } from '@/domain/types'
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
import {
  fixtureOf,
  isDeciderEligible,
  matchLabel,
  matchPair,
  openGame,
  pairPlayers,
  scoreText,
  sideTeamId,
  stageRule,
  teamName,
} from '@/features/tournament/labels'
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

type PlayingMatch = FixtureMatch & { state: 'playing' }

function isPlaying(match: FixtureMatch): match is PlayingMatch {
  return match.state === 'playing'
}

/** Ready for a referee to start: court assigned, pairs revealed, decider eligible. */
function startableMatches(snapshot: TournamentSnapshot): FixtureMatch[] {
  return snapshot.matches.filter((match) =>
    match.state === 'unstarted'
    && match.court !== null
    && match.pairA !== null
    && isDeciderEligible(snapshot, match),
  )
}

const emptyGame: Game = { gameNumber: 1, score: { a: 0, b: 0 }, confirmedAt: null }

function liveGame(match: FixtureMatch): Game {
  return openGame(match) ?? emptyGame
}

function stageOf(snapshot: TournamentSnapshot, match: FixtureMatch) {
  return fixtureOf(snapshot, match)?.stage ?? 'qualifying'
}

function createInitialState(snapshot: TournamentSnapshot, match: PlayingMatch, resetGeneration: number, hasOwnership: boolean): IdleScoringState {
  const game = liveGame(match)
  return {
    status: 'idle',
    matchId: match.id,
    stage: stageOf(snapshot, match),
    resetGeneration,
    gameNumber: game.gameNumber,
    score: game.score,
    matchVersion: match.version,
    hasOwnership,
  }
}

async function latestMatch(matchId: string, resetGeneration: number): Promise<PlayingMatch> {
  const state = await fetchTournament()
  if (state.resetGeneration !== resetGeneration) throw new Error(messages.scoring.tournamentReset)
  const snapshot = state.snapshot
  if (snapshot === null) throw new Error(messages.scoring.tournamentReset)
  const match = snapshot.matches.find((candidate): candidate is PlayingMatch => candidate.id === matchId && isPlaying(candidate))
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
  const [state, dispatch] = useReducer(reduceScoring, createInitialState(snapshot, match, resetGeneration, ownership))
  const game = liveGame(match)
  const fixture = fixtureOf(snapshot, match)
  const [takeoverOpen, setTakeoverOpen] = useState(false)
  const [actionFailure, setActionFailure] = useState<string | null>(null)

  useEffect(() => {
    dispatch({
      type: 'snapshot-received',
      resetGeneration,
      gameNumber: game.gameNumber,
      score: game.score,
      matchVersion: match.version,
      hasOwnership: ownership,
    })
  }, [game.gameNumber, game.score, match.version, ownership, resetGeneration])

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
    if (state.status !== 'idle' || !state.hasOwnership || isGameWon(state.score, state.stage)) return
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
      (candidate): candidate is PlayingMatch => candidate.id === match.id && isPlaying(candidate),
    )
    if (!latest) return
    const hasOwnership = await canScore(match.id)
    queryClient.setQueryData(['score-access', latestState.resetGeneration, match.id], hasOwnership)
    const latestGame = liveGame(latest)
    dispatch({
      type: 'snapshot-received',
      resetGeneration: latestState.resetGeneration,
      gameNumber: latestGame.gameNumber,
      score: latestGame.score,
      matchVersion: latest.version,
      hasOwnership,
    })
  }

  const handleActionFailure = async (action: string, error: unknown): Promise<void> => {
    try {
      await reconcileAfterAction()
      setActionFailure(messages.scoring.actionFailed(action, message(error)))
    } catch {
      setActionFailure(messages.scoring.actionUnverified(action, message(error)))
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
      const latestGame = liveGame(latest)
      if (hasOwnership) {
        dispatch({ type: 'ownership-recovered', resetGeneration, gameNumber: latestGame.gameNumber, score: latestGame.score, matchVersion: latest.version })
      } else {
        dispatch({ type: 'snapshot-received', resetGeneration, gameNumber: latestGame.gameNumber, score: latestGame.score, matchVersion: latest.version, hasOwnership: false })
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
    mutationFn: async () => {
      const gameNumber = state.gameNumber
      const receipt = await mutateTournament('confirm_game', {
        requestId: crypto.randomUUID(),
        resetGeneration,
        expectedVersion: state.matchVersion,
        payload: { matchId: match.id },
      })
      return { receipt, gameNumber }
    },
    onSuccess: ({ receipt, gameNumber }) => {
      if (receipt.matchVersion === null) return
      dispatch({ type: 'game-confirmed', resetGeneration, gameNumber: gameNumber + 1, matchVersion: receipt.matchVersion })
    },
    onError: (error) => handleActionFailure(messages.scoring.actions.confirm, error),
  })

  const failed = state.status === 'failed' ? state : null
  const needsTakeover = !state.hasOwnership || failed?.reason === 'ownership-conflict'
  const actionPending = takeoverMutation.isPending || undoMutation.isPending || confirmMutation.isPending
  const disabled = state.status !== 'idle' || !state.hasOwnership || isGameWon(state.score, state.stage) || actionPending
  const tally = matchGameTally(match.games)

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
        <span className="hidden text-right text-xs font-semibold sm:block">
          {match.court ? messages.common.court(match.court) : '–'}
          <span className="block font-normal text-muted-ink">
            {gamesToWinMatch(state.stage) === 2 ? messages.scoring.gameStatus(state.gameNumber, scoreText(tally)) : stageRule(state.stage)}
          </span>
        </span>
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
            aria-label={messages.scoring.addPoint(pairPlayers(snapshot, matchPair(snapshot, match, side)))}
            onClick={() => handlePoint(side)}
          >
            <span className="max-w-full [overflow-wrap:anywhere] text-[clamp(0.9375rem,2.4vw,1.625rem)]/[1.35] font-semibold tracking-[-0.023em]">
              {pairPlayers(snapshot, matchPair(snapshot, match, side))}
            </span>
            <strong className="numeric self-center pr-[0.07em] text-[clamp(5rem,28dvh,16rem)] font-bold leading-none tracking-[-0.08em]">
              {formatNumber(state.score[side])}
            </strong>
            <small className="text-[0.625rem] opacity-75">
              {teamName(snapshot, sideTeamId(fixture, side))}
              {gamesToWinMatch(state.stage) === 2 ? ` · ${formatNumber(tally[side])}` : ''}
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
            <AlertDialogTitle>{messages.scoring.confirmTitle(state.gameNumber)}</AlertDialogTitle>
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

function MatchPicker({
  snapshot,
  resetGeneration,
  onSelect,
  onExit,
}: {
  snapshot: TournamentSnapshot
  resetGeneration: number
  onSelect: (matchId: UUID) => void
  onExit: () => void
}) {
  const playing = snapshot.matches.filter(isPlaying)
  const startable = startableMatches(snapshot)
  const [startMatchId, setStartMatchId] = useState<UUID | null>(null)
  const startMatch = startable.find((match) => match.id === startMatchId)

  const startMutation = useMutation({
    mutationFn: (match: FixtureMatch) => mutateTournament('start_match', {
      requestId: crypto.randomUUID(),
      resetGeneration,
      expectedVersion: match.version,
      payload: { matchId: match.id },
    }),
    onSuccess: (receipt) => {
      setStartMatchId(null)
      if (receipt.matchId) onSelect(receipt.matchId)
    },
  })

  const row = (match: FixtureMatch, action: React.ReactNode) => (
    <li className="grid gap-2.5 border-t border-hairline py-4 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={match.id}>
      <span className="min-w-0">
        <span className="block text-[0.6875rem] text-muted-ink">
          {match.court ? messages.common.court(match.court) : '–'} · {matchLabel(snapshot, match)}
        </span>
        <span className="mt-1 block text-[0.8125rem] font-medium [overflow-wrap:anywhere]">
          {messages.common.versus(pairPlayers(snapshot, matchPair(snapshot, match, 'a')), pairPlayers(snapshot, matchPair(snapshot, match, 'b')))}
        </span>
        {isPlaying(match) ? (
          <span className="mt-1 block text-[0.6875rem] text-muted-ink">
            {fixtureOf(snapshot, match)?.stage === 'final'
              ? `${messages.scoring.gameStatus(liveGame(match).gameNumber, scoreText(matchGameTally(match.games)))} · `
              : ''}
            {scoreText(liveGame(match).score)}
          </span>
        ) : null}
      </span>
      {action}
    </li>
  )

  return (
    <main className="app-shell space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" size="sm" onClick={onExit}>
          <ArrowLeft /> {messages.scoring.backToMatches}
        </Button>
        <h2 className="text-lg font-semibold tracking-[-0.033em]">{messages.scoring.pickHeading}</h2>
      </div>
      {playing.length > 0 ? (
        <section className="rounded-card border border-ink/5 bg-white px-5 py-2 shadow-card">
          <h3 className="pt-3 text-sm font-semibold">{messages.scoring.resumeHeading}</h3>
          <ul>{playing.map((match) => row(match, <Button onClick={() => onSelect(match.id)}>{messages.scoring.resume}</Button>))}</ul>
        </section>
      ) : null}
      <section className="rounded-card border border-ink/5 bg-white px-5 py-2 shadow-card">
        <h3 className="pt-3 text-sm font-semibold">{messages.scoring.startHeading}</h3>
        {startable.length === 0 ? (
          <p className="py-4 text-[0.8125rem] text-muted-ink">{messages.scoring.noMatch}</p>
        ) : (
          <ul>
            {startable.map((match) => row(match, (
              <Button variant="outline" disabled={startMutation.isPending} onClick={() => setStartMatchId(match.id)}>
                <Play /> {messages.scoring.start}
              </Button>
            )))}
          </ul>
        )}
      </section>
      {startMutation.isError ? <p className="text-sm text-destructive" role="alert">{errorMessage(startMutation.error)}</p> : null}

      <AlertDialog open={startMatch !== undefined} onOpenChange={(open) => { if (!open) setStartMatchId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{messages.scoring.startTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {startMatch?.court ? messages.scoring.startBody(messages.common.court(startMatch.court)) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{messages.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={startMatch === undefined || startMutation.isPending}
              onClick={() => { if (startMatch) startMutation.mutate(startMatch) }}
            >
              {startMutation.isPending ? messages.scoring.starting : messages.scoring.start}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}

export function ScoreTracker({ snapshot, resetGeneration, onExit }: { snapshot: TournamentSnapshot; resetGeneration: number; onExit: () => void }) {
  const [matchId, setMatchId] = useState<UUID | null>(null)
  const match = snapshot.matches.find((candidate): candidate is PlayingMatch => candidate.id === matchId && isPlaying(candidate))
  const ownershipQuery = useQuery({
    queryKey: ['score-access', resetGeneration, match?.id],
    queryFn: () => canScore(match?.id ?? ''),
    enabled: match !== undefined,
    refetchInterval: 5_000,
  })

  // A completed match leaves the playing set, which returns here to the picker.
  if (!match) {
    return <MatchPicker snapshot={snapshot} resetGeneration={resetGeneration} onSelect={setMatchId} onExit={onExit} />
  }

  if (ownershipQuery.isPending) {
    return <main className="score-viewport grid place-items-center text-sm">{messages.scoring.recovering}</main>
  }

  return (
    <ScoringSurface
      key={`${resetGeneration}-${match.id}`}
      match={match}
      snapshot={snapshot}
      resetGeneration={resetGeneration}
      ownership={ownershipQuery.data ?? false}
      onExit={() => setMatchId(null)}
    />
  )
}
