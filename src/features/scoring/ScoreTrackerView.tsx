import type { ScoringState } from './scoring-state'
import { ArrowLeft, ArrowLeftRight, RefreshCw, RotateCcw, ShieldAlert } from 'lucide-react'

import { gamesToWinMatch, isGameWon, matchGameTally } from '@/domain/scoring'
import type { FixtureMatch, Side, TournamentSnapshot } from '@/domain/types'
import { PairDisplay } from '@/features/tournament/Participants'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { courtLabel, fixtureOf, matchPair, pairPlayers, scoreText, sideTeamId, stageRule, teamName } from '@/features/tournament/labels'
import { formatNumber } from '@/i18n/format'
import { messages } from '@/i18n/messages'
import { cn } from '@/lib/utils'

export function ScoreTrackerView({ snapshot, match, state, sidesSwapped, screenOrder, actionPending, actionFailure, takeoverOpen, takeoverPending, onExit, toggleSides, handlePoint, handleRetry, onUndo, onConfirm, onTakeover, onReconcile, onDismissReview, setTakeoverOpen, dialogs = true }: {
  snapshot: TournamentSnapshot; match: FixtureMatch; state: ScoringState; sidesSwapped: boolean; screenOrder: readonly Side[];
  actionPending: boolean; actionFailure: string | null; takeoverOpen: boolean; takeoverPending: boolean; dialogs?: boolean;
  onExit: () => void; toggleSides: () => void; handlePoint: (side: Side) => void; handleRetry: () => void;
  onUndo: () => void; onConfirm: () => void; onTakeover: () => void; onReconcile: () => void; onDismissReview: () => void; setTakeoverOpen: (open: boolean) => void;
}) {
  const fixture = fixtureOf(snapshot, match)
  const failed = state.status === 'failed' ? state : null
  const needsTakeover = !state.hasOwnership || failed?.reason === 'ownership-conflict'
  const disabled = state.status !== 'idle' || !state.hasOwnership || isGameWon(state.score, state.stage) || actionPending
  const tally = matchGameTally(match.games)

  return (
    <main className="score-viewport scoring-surface grid bg-background">
      <div className="score-header grid items-center gap-2">
        <Button variant="outline" size="sm" onClick={onExit}>
          <ArrowLeft /> {messages.scoring.back}
        </Button>
        <div className="score-feedback min-h-8 min-w-0 self-center text-center text-[0.8125rem] text-navy" data-guide="save" aria-live="polite">
          {state.status === 'saving' ? messages.scoring.savingPoint : null}
          {failed ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="text-destructive">{failed.message}</span>
              {failed.reason === 'version-conflict' && failed.observed ? (
                <Button size="sm" variant="outline" onClick={() => onReconcile()}>
                  {messages.scoring.useLatestScore}
                </Button>
              ) : null}
              {!needsTakeover ? (
                <Button size="sm" variant="outline" data-guide="retry" onClick={handleRetry}><RefreshCw /> {messages.scoring.retry}</Button>
              ) : null}
            </div>
          ) : null}
          {needsTakeover ? (
            <Button size="sm" variant="outline" className="rounded-full" disabled={actionPending} data-guide="takeover" onClick={() => setTakeoverOpen(true)}>
              <ShieldAlert /> {messages.scoring.takeOverScoring}
            </Button>
          ) : null}
          {actionFailure ? <p className="mt-1 text-destructive" role="alert">{actionFailure}</p> : null}
        </div>
        <div className="score-details flex items-center gap-3">
          <span data-guide="game" className="score-court min-w-0 text-right text-xs font-semibold [overflow-wrap:anywhere]">
            {match.court ? courtLabel(snapshot, match.court) : '–'}
            <span className="block font-normal text-muted-ink">
              {gamesToWinMatch(state.stage) === 2 ? messages.scoring.gameStatus(state.gameNumber, scoreText(tally)) : stageRule(state.stage)}
            </span>
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            data-guide="swap"
            aria-label={messages.scoring.swapSides}
            aria-pressed={sidesSwapped}
            title={messages.scoring.swapSides}
            onClick={toggleSides}
          >
            <ArrowLeftRight />
          </Button>
        </div>
      </div>

      <div className="score-panels grid min-h-0 gap-2">
        {screenOrder.map((side) => (
          <button
            type="button"
            key={side}
            data-guide={side === 'a' ? 'point' : undefined}
            className={cn(
              'score-panel grid min-h-0 touch-manipulation select-none rounded-card border p-4 transition-colors disabled:cursor-default',
              side === 'a' ? 'border-peach-line bg-peach text-ink' : 'border-line bg-ice text-ink',
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

      <div className="score-actions grid grid-cols-2 gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="min-w-22"
          disabled={actionPending || state.status === 'saving' || state.status === 'failed' || !state.hasOwnership}
          data-guide="undo" onClick={() => onUndo()}
        >
          <RotateCcw /> {messages.scoring.undo}
        </Button>
        <Button
          size="sm"
          className="min-w-22"
          disabled={state.status !== 'reviewing' || actionPending}
          onClick={() => onConfirm()}
        >
          {messages.scoring.confirm}
        </Button>
      </div>



      <AlertDialog open={dialogs && state.status === 'reviewing'} onOpenChange={(open) => {
        if (!open) onDismissReview()
      }}>
        <AlertDialogContent>
          <ScoreConfirmationView kind="result" gameNumber={state.gameNumber} score={[state.score[screenOrder[0]], state.score[screenOrder[1]]]} pending={actionPending} onCancel={onDismissReview} onConfirm={onConfirm} />
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={dialogs && takeoverOpen} onOpenChange={setTakeoverOpen}>
        <AlertDialogContent>
          <ScoreConfirmationView kind="takeover" pending={takeoverPending} onCancel={() => setTakeoverOpen(false)} onConfirm={onTakeover} />
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}

export function ScoreConfirmationView({ kind, gameNumber = 1, score = [0, 0], pending = false, onCancel, onConfirm, inline = false }: {
  kind: 'result' | 'takeover' | 'start'; gameNumber?: number; score?: readonly [number, number]; pending?: boolean;
  onCancel: () => void; onConfirm: () => void; inline?: boolean;
}) {
  const Title = inline ? 'h2' : AlertDialogTitle
  const Description = inline ? 'p' : AlertDialogDescription
  const Cancel = inline ? Button : AlertDialogCancel
  const Confirm = inline ? Button : AlertDialogAction
  const title = kind === 'result' ? messages.scoring.confirmTitle(gameNumber) : kind === 'start' ? messages.scoring.startTitle : messages.scoring.takeoverTitle
  const description = kind === 'result' ? messages.scoring.confirmBody(score[0], score[1]) : kind === 'start' ? messages.scoring.startBody('Sân xanh') : messages.scoring.takeoverBody
  return <>
    <div className="space-y-2">
      <Title className="text-base font-semibold">{title}</Title>
      <Description className="text-sm text-muted-ink">{description}</Description>
    </div>
    <div className="mt-5 flex flex-wrap justify-end gap-2">
      <Cancel onClick={onCancel}>{kind === 'result' ? messages.scoring.reviewAndUndo : messages.common.cancel}</Cancel>
      <Confirm disabled={pending} onClick={onConfirm}>{kind === 'result' ? messages.scoring.confirmResult : kind === 'start' ? messages.scoring.start : messages.scoring.takeOver}</Confirm>
    </div>
  </>
}
