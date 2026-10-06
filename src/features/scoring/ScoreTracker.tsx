import { useEffect, useReducer, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowLeftRight, Play, RefreshCw, RotateCcw, ShieldAlert, Users } from 'lucide-react'

import { canScore } from '@/data/staff'
import { fetchTournament, mutateTournament } from '@/data/tournament'
import { gamesToWinMatch, isGameWon, matchGameTally } from '@/domain/scoring'
import type { FixtureMatch, Game, Side, StaffRole, TournamentSnapshot, UUID } from '@/domain/types'
import {
  reduceScoring,
  type IdleScoringState,
  type PendingPoint,
  type SaveFailureReason,
} from './scoring-state'
import { PairAssignmentForm } from './PairAssignmentForm'
import { PairLines } from '@/features/tournament/PairLines'
import { PairDisplay, SeedLegend } from '@/features/tournament/Participants'
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
import { Dialog, DialogContent } from '@/components/ui/dialog'
import {
  courtLabel,
  fixtureLabel,
  fixtureOf,
  groupByFixture,
  isStartable,
  startBlocker,
  matchLabel,
  matchPair,
  openGame,
  pairPlayers,
  scoreText,
  sideTeamId,
  stageRule,
  teamName,
  upcomingMatches,
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

/**
 * Whether this device shows side B on the left for a match. Stored per device
 * so a reload keeps the referee's view; storage may be unavailable, in which
 * case the default order applies.
 */
function readSidesSwapped(matchId: UUID): boolean {
  try {
    return window.localStorage.getItem(`badminton:sides-swapped:${matchId}`) === '1'
  } catch {
    return false
  }
}

function writeSidesSwapped(matchId: UUID, swapped: boolean): void {
  try {
    if (swapped) window.localStorage.setItem(`badminton:sides-swapped:${matchId}`, '1')
    else window.localStorage.removeItem(`badminton:sides-swapped:${matchId}`)
  } catch {
    // The view still swaps for this visit; it just is not remembered.
  }
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
  const [sidesSwapped, setSidesSwapped] = useState(() => readSidesSwapped(match.id))
  const screenOrder: readonly Side[] = sidesSwapped ? ['b', 'a'] : ['a', 'b']
  const toggleSides = () => {
    setSidesSwapped((current) => {
      writeSidesSwapped(match.id, !current)
      return !current
    })
  }

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
    <main className="score-viewport scoring-surface grid gap-3 bg-background">
      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" size="sm" onClick={onExit}>
          <ArrowLeft /> {messages.scoring.back}
        </Button>
        <div className="flex items-center gap-3">
          <span className="min-w-0 text-right text-xs font-semibold [overflow-wrap:anywhere]">
            {match.court ? courtLabel(snapshot, match.court) : '–'}
            <span className="block font-normal text-muted-ink">
              {gamesToWinMatch(state.stage) === 2 ? messages.scoring.gameStatus(state.gameNumber, scoreText(tally)) : stageRule(state.stage)}
            </span>
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={messages.scoring.swapSides}
            aria-pressed={sidesSwapped}
            title={messages.scoring.swapSides}
            onClick={toggleSides}
          >
            <ArrowLeftRight />
          </Button>
        </div>
      </div>

      <div className="score-panels grid min-h-0 gap-3">
        {screenOrder.map((side) => (
          <button
            type="button"
            key={side}
            className={cn(
              'score-panel grid min-h-0 touch-manipulation select-none rounded-card border p-5 transition-colors disabled:cursor-default',
              side === 'a' ? 'border-peach-line border-t-4 border-t-orange bg-peach text-ink' : 'border-line border-t-4 border-t-cyan bg-ice text-ink',
            )}
            disabled={disabled}
            aria-label={messages.scoring.addPoint(pairPlayers(snapshot, matchPair(match, side)))}
            onClick={() => handlePoint(side)}
          >
            <PairDisplay snapshot={snapshot} pair={matchPair(match, side)} className="max-w-full" />
            <strong className="score-number numeric font-bold leading-none tracking-[-0.07em]">
              {formatNumber(state.score[side])}
            </strong>
            <small className="score-team max-w-full text-sm opacity-80 [overflow-wrap:anywhere]">
              {teamName(snapshot, sideTeamId(fixture, side))}
              {gamesToWinMatch(state.stage) === 2 ? ` · ${formatNumber(tally[side])}` : ''}
            </small>
          </button>
        ))}
      </div>

      <div className="score-actions grid grid-cols-2 gap-3">
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

      <div className="min-h-8 self-center text-center text-[0.8125rem] text-navy" aria-live="polite">
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
              {messages.scoring.confirmBody(state.score[screenOrder[0]], state.score[screenOrder[1]])}
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
  role,
  onSelect,
  onExit,
}: {
  snapshot: TournamentSnapshot
  resetGeneration: number
  role: StaffRole
  onSelect: (matchId: UUID) => void
  onExit: () => void
}) {
  const playing = snapshot.matches.filter(isPlaying)
  const upcoming = upcomingMatches(snapshot)
  const [startMatchId, setStartMatchId] = useState<UUID | null>(null)
  const startMatch = upcoming.find((match) => match.id === startMatchId && isStartable(match))
  // The fixture outlives `assignOpen` so the dialog keeps its content while closing.
  const [assignFixtureId, setAssignFixtureId] = useState<UUID | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)

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
    <li className="grid gap-3 border-t border-hairline py-4 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={match.id}>
      <div className="min-w-0">
        <span className="block text-[0.9375rem] font-semibold [overflow-wrap:anywhere]">
          {messages.common.versus(teamName(snapshot, sideTeamId(fixtureOf(snapshot, match), 'a')), teamName(snapshot, sideTeamId(fixtureOf(snapshot, match), 'b')))}
        </span>
        <span className="mt-1 block text-[0.8125rem] text-muted-ink">
          {match.court ? courtLabel(snapshot, match.court) : messages.publicView.courtPending} · {matchLabel(snapshot, match)}
        </span>
        <PairLines snapshot={snapshot} match={match} className="mt-1" />
        {isPlaying(match) ? (
          <span className="mt-1 block text-[0.8125rem] text-muted-ink">
            {gamesToWinMatch(stageOf(snapshot, match)) === 2
              ? `${messages.scoring.gameStatus(liveGame(match).gameNumber, scoreText(matchGameTally(match.games)))} · `
              : ''}
            {scoreText(liveGame(match).score)}
          </span>
        ) : null}
      </div>
      {action}
    </li>
  )

  return (
    <main className="app-shell space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" size="sm" onClick={onExit}>
          <ArrowLeft /> {messages.scoring.back}
        </Button>
        <h2 className="text-lg font-semibold tracking-[-0.033em]">{messages.scoring.pickHeading}</h2>
      </div>
      <SeedLegend />
      {playing.length > 0 ? (
        <section className="rounded-card border border-ink/5 bg-white px-5 py-2 shadow-card">
          <h3 className="pt-3 text-sm font-semibold">{messages.scoring.resumeHeading}</h3>
          <ul>{playing.map((match) => row(match, <Button onClick={() => onSelect(match.id)}>{messages.scoring.resume}</Button>))}</ul>
        </section>
      ) : null}
      <section className="rounded-card border border-ink/5 bg-white px-5 py-2 shadow-card">
        <h3 className="pt-3 text-sm font-semibold">{messages.scoring.startHeading}</h3>
        {upcoming.length === 0 ? (
          <p className="py-4 text-sm text-muted-ink">{messages.scoring.noMatch}</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {groupByFixture(upcoming).map(({ fixtureId, matches }) => {
              const fixture = snapshot.fixtures.find((candidate) => candidate.id === fixtureId)
              const fixtureTeams = messages.common.versus(teamName(snapshot, sideTeamId(fixture, 'a')), teamName(snapshot, sideTeamId(fixture, 'b')))
              const paired = matches.every((match) => match.pairA !== null && match.pairB !== null)
              return (
                <li className="py-4" aria-label={`${fixtureLabel(fixture)} · ${fixtureTeams}`} key={fixtureId}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[0.9375rem] font-semibold [overflow-wrap:anywhere]">{fixtureTeams}</p>
                      <p className="mt-0.5 text-[0.8125rem] text-muted-ink">{fixtureLabel(fixture)}</p>
                    </div>
                    <Button className="w-[7.5rem]" variant={paired ? 'outline' : 'default'} onClick={() => { setAssignFixtureId(fixtureId); setAssignOpen(true) }}>
                      <Users /> {messages.pairAssignment.open}
                    </Button>
                  </div>
                  <ul className="mt-3 space-y-3 border-l-2 border-hairline pl-3 sm:pl-4">
                    {matches.map((match) => (
                      <li className="grid grid-cols-[minmax(0,1fr)_7.5rem] items-center gap-x-3 gap-y-1" aria-label={messages.common.matchNumber(match.matchNumber)} key={match.id}>
                        <p className="text-sm font-semibold">
                          {messages.common.matchNumber(match.matchNumber)}
                          <span className="font-normal text-muted-ink"> · {match.court ? courtLabel(snapshot, match.court) : messages.publicView.courtPending}</span>
                        </p>
                        <p className="text-right text-xs text-muted-ink">
                          {startBlocker(snapshot, match) ? messages.scoring.startBlocked[startBlocker(snapshot, match) ?? 'pairs'] : null}
                        </p>
                        <PairLines snapshot={snapshot} match={match} />
                        <Button className="w-full" disabled={startBlocker(snapshot, match) !== null || startMutation.isPending} onClick={() => setStartMatchId(match.id)}>
                          <Play /> {messages.scoring.start}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="flex max-h-[calc(100dvh-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
          {assignFixtureId ? (
            <PairAssignmentForm
              key={assignFixtureId}
              snapshot={snapshot}
              fixtureId={assignFixtureId}
              role={role}
              resetGeneration={resetGeneration}
              onSaved={() => setAssignOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      {startMutation.isError ? <p className="text-sm text-destructive" role="alert">{errorMessage(startMutation.error)}</p> : null}

      <AlertDialog open={startMatch !== undefined} onOpenChange={(open) => { if (!open) setStartMatchId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{messages.scoring.startTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {startMatch?.court ? messages.scoring.startBody(courtLabel(snapshot, startMatch.court)) : null}
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

export function ScoreTracker({ snapshot, resetGeneration, role, onExit }: { snapshot: TournamentSnapshot; resetGeneration: number; role: StaffRole; onExit: () => void }) {
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
    return <MatchPicker snapshot={snapshot} resetGeneration={resetGeneration} role={role} onSelect={setMatchId} onExit={onExit} />
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
