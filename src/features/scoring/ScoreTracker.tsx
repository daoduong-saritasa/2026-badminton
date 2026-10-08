import { MatchPickerView } from './MatchPickerView'
import { ScoreTrackerView } from './ScoreTrackerView'
import { useEffect, useReducer, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { canScore } from '@/data/staff'
import { fetchTournament, mutateTournament } from '@/data/tournament'
import { isGameWon } from '@/domain/scoring'
import type { FixtureMatch, Game, Side, StaffRole, TournamentSnapshot, UUID } from '@/domain/types'
import { reduceScoring, type IdleScoringState, type PendingPoint, type SaveFailureReason } from './scoring-state'
import { CourtSelect } from './CourtSelect'
import { PairAssignmentForm } from './PairAssignmentForm'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { courtLabel, fixtureOf, startBlocker, matchLabel, openGame, upcomingMatches } from '@/features/tournament/labels'
import { errorMessage } from '@/i18n/errors'
import { messages } from '@/i18n/messages'

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

  return <ScoreTrackerView snapshot={snapshot} match={match} state={state} sidesSwapped={sidesSwapped} screenOrder={screenOrder}
    actionPending={takeoverMutation.isPending || undoMutation.isPending || confirmMutation.isPending} actionFailure={actionFailure}
    takeoverOpen={takeoverOpen} takeoverPending={takeoverMutation.isPending} setTakeoverOpen={setTakeoverOpen}
    onExit={onExit} toggleSides={toggleSides} handlePoint={handlePoint} handleRetry={handleRetry}
    onUndo={() => undoMutation.mutate()} onConfirm={() => confirmMutation.mutate()} onTakeover={() => takeoverMutation.mutate()}
    onReconcile={() => dispatch({ type: 'version-conflict-reconciled' })} onDismissReview={() => dispatch({ type: 'review-dismissed' })} />
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
  const upcoming = upcomingMatches(snapshot)
  const [startMatchId, setStartMatchId] = useState<UUID | null>(null)
  const startMatch = upcoming.find((match) => match.id === startMatchId && startBlocker(snapshot, match) === null)
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

  return (
    <main className="app-shell space-y-6">
      <MatchPickerView snapshot={snapshot} onSelect={onSelect} onExit={onExit} startPending={startMutation.isPending}
        onStart={setStartMatchId} onAssign={(fixtureId) => { setAssignFixtureId(fixtureId); setAssignOpen(true) }}
        courtControl={(match) => (
          <CourtSelect snapshot={snapshot} match={match} resetGeneration={resetGeneration}
            label={messages.organizer.schedule.courtFor(matchLabel(snapshot, match))} />
        )} />
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
