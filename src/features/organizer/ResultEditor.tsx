import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { previewResultCorrection } from '@/data/impacts'
import { mutateTournament } from '@/data/tournament'
import { correctedMatchWinner, gameRules, gamesToWinMatch } from '@/domain/scoring'
import type { MutationImpact } from '@/domain/impacts'
import type { Score, Side, TournamentSnapshot, UUID } from '@/domain/types'
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
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  confirmedGames,
  fixtureOf,
  matchLabel,
  matchPair,
  pairPlayers,
  sideTeamId,
  teamName,
} from '@/features/tournament/labels'
import { errorMessage } from '@/i18n/errors'
import { messages } from '@/i18n/vi'
import { ImpactPreview } from './ImpactPreview'

export interface ResultEditorProps {
  snapshot: TournamentSnapshot
  resetGeneration: number
  matchId: UUID
  onClose: () => void
}

interface GameDraft {
  a: string
  b: string
}

function WalkoverForm({ snapshot, resetGeneration, matchId, onClose }: ResultEditorProps) {
  const match = snapshot.matches.find((candidate) => candidate.id === matchId)
  const fixture = match ? fixtureOf(snapshot, match) : undefined
  const [winnerSide, setWinnerSide] = useState<Side>('a')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const mutation = useMutation({
    mutationFn: () => {
      if (!match) throw new Error(messages.results.matchGone)
      return mutateTournament('mark_walkover', {
        requestId: crypto.randomUUID(),
        resetGeneration,
        expectedVersion: match.version,
        payload: { matchId, winnerSide },
      })
    },
    onSuccess: () => {
      setConfirmOpen(false)
      onClose()
    },
  })
  const winnerName = teamName(snapshot, sideTeamId(fixture, winnerSide))

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="walkover-winner">{messages.results.walkoverWinner}</Label>
        <Select value={winnerSide} onValueChange={(value) => setWinnerSide(value as Side)}>
          <SelectTrigger id="walkover-winner" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(['a', 'b'] as const).map((side) => (
              <SelectItem value={side} key={side}>{teamName(snapshot, sideTeamId(fixture, side))}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {mutation.isError ? <p className="text-sm text-destructive" role="alert">{errorMessage(mutation.error)}</p> : null}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>{messages.common.cancel}</Button>
        <Button disabled={mutation.isPending} onClick={() => setConfirmOpen(true)}>{messages.results.walkover}</Button>
      </DialogFooter>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{messages.results.confirmWalkoverTitle}</AlertDialogTitle>
            <AlertDialogDescription>{messages.results.walkoverConsequence(winnerName)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{messages.common.cancel}</AlertDialogCancel>
            <AlertDialogAction disabled={mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? messages.common.saving : messages.results.confirmWalkover}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// A preview describes one exact result revision, so it must not outlive it. It
// is stored with the revision it was built from and goes stale during render,
// rather than being destroyed by a remount: a remount on every scored point
// would wipe the typed games mid-review.
function CorrectionForm({ snapshot, resetGeneration, matchId, onClose }: ResultEditorProps) {
  const match = snapshot.matches.find((candidate) => candidate.id === matchId)
  const stage = (match ? fixtureOf(snapshot, match)?.stage : undefined) ?? 'qualifying'
  // A final is best of three; every other match is a single game.
  const bestOfThree = gamesToWinMatch(stage) === 2
  const minimumGames = bestOfThree ? 2 : 1
  const [games, setGames] = useState<GameDraft[]>(() => {
    const recorded = match ? confirmedGames(match) : []
    const drafts = recorded
      .map((game) => ({ a: String(game.score.a), b: String(game.score.b) }))
      .slice(0, bestOfThree ? 3 : 1)
    return drafts.length >= minimumGames ? drafts : Array.from({ length: minimumGames }, () => ({ a: '', b: '' }))
  })
  const [reviewed, setReviewed] = useState<{ impact: MutationImpact; revision: number } | null>(null)

  const scores: Score[] = games.map((game) => ({ a: Number(game.a), b: Number(game.b) }))
  const complete = games.every((game) => game.a.trim() !== '' && game.b.trim() !== '')
  const winnerSide = complete ? correctedMatchWinner(scores, stage) : null
  const { target, cap } = gameRules(stage)

  const previewMutation = useMutation({
    mutationFn: (side: Side) => {
      if (!match) throw new Error(messages.results.matchGone)
      return previewResultCorrection({ matchId, matchVersion: match.version, winnerSide: side, games: scores }, resetGeneration)
    },
    onSuccess: (result) => setReviewed({ impact: result, revision: result.tournamentVersion }),
  })

  const saveMutation = useMutation({
    mutationFn: ({ side, previewTournamentVersion }: { side: Side; previewTournamentVersion: number }) => {
      if (!match) throw new Error(messages.results.matchGone)
      return mutateTournament('correct_result', {
        requestId: crypto.randomUUID(),
        resetGeneration,
        expectedVersion: match.version,
        payload: { matchId, winnerSide: side, games: scores, previewTournamentVersion },
      })
    },
    onSuccess: () => {
      setReviewed(null)
      onClose()
    },
  })

  if (!match) return null

  // Anything that moved a result since the review invalidates the projection
  // on screen, so the dialog closes and the organizer reviews again.
  const impact = reviewed && reviewed.revision === snapshot.tournament.resultRevision ? reviewed.impact : null
  const updateGame = (index: number, side: Side, value: string) => {
    setGames((current) => current.map((game, gameIndex) => gameIndex === index ? { ...game, [side]: value } : game))
  }

  return (
    <>
      <div className="space-y-3">
        {games.map((game, index) => (
          <div className="grid grid-cols-[3rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3" key={index}>
            <span className="text-[0.6875rem] text-muted-ink">{messages.common.gameNumber(index + 1)}</span>
            {(['a', 'b'] as const).map((side) => (
              <Input
                key={side}
                className="numeric"
                type="number"
                inputMode="numeric"
                min="0"
                max={cap}
                aria-label={messages.results.gameScore(index + 1, pairPlayers(snapshot, matchPair(match, side)))}
                value={game[side]}
                onChange={(event) => updateGame(index, side, event.target.value)}
              />
            ))}
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={winnerSide ? 'text-[0.6875rem] text-muted-ink' : 'text-[0.6875rem] text-destructive'}>
            {messages.results.scoreHint(target, cap, bestOfThree)}
          </p>
          {bestOfThree && games.length === 2 ? (
            <Button size="sm" variant="ghost" onClick={() => setGames((current) => [...current, { a: '', b: '' }])}>{messages.results.addGame}</Button>
          ) : bestOfThree ? (
            <Button size="sm" variant="ghost" onClick={() => setGames((current) => current.slice(0, 2))}>{messages.results.removeGame}</Button>
          ) : null}
        </div>
      </div>

      {previewMutation.isError ? <p className="text-sm text-destructive" role="alert">{errorMessage(previewMutation.error)}</p> : null}
      {saveMutation.isError ? <p className="text-sm text-destructive" role="alert">{errorMessage(saveMutation.error)}</p> : null}

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>{messages.common.cancel}</Button>
        <Button disabled={winnerSide === null || previewMutation.isPending} onClick={() => { if (winnerSide) previewMutation.mutate(winnerSide) }}>
          {previewMutation.isPending ? messages.common.checking : messages.results.reviewCorrection}
        </Button>
      </DialogFooter>

      <AlertDialog open={impact !== null} onOpenChange={(open) => { if (!open) setReviewed(null) }}>
        <AlertDialogContent size="wide">
          <AlertDialogHeader>
            <AlertDialogTitle>{messages.results.confirmCorrectionTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {impact?.blockedReason === null ? messages.results.reviewBeforeConfirm : messages.results.cannotApply}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {impact ? <ImpactPreview impact={impact} matchId={matchId} /> : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{messages.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={impact === null || impact.blockedReason !== null || winnerSide === null || saveMutation.isPending}
              onClick={() => {
                if (impact && impact.blockedReason === null && winnerSide) {
                  saveMutation.mutate({ side: winnerSide, previewTournamentVersion: impact.tournamentVersion })
                }
              }}
            >
              {saveMutation.isPending ? messages.common.saving : messages.results.confirmChange}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function ResultEditor(props: ResultEditorProps) {
  const { snapshot, matchId } = props
  const match = snapshot.matches.find((candidate) => candidate.id === matchId)

  if (!match) {
    return (
      <DialogHeader>
        <DialogTitle>{messages.results.correctTitle}</DialogTitle>
        <DialogDescription>{messages.results.matchGone}</DialogDescription>
      </DialogHeader>
    )
  }

  const isCorrection = match.state === 'completed'
  const fixture = fixtureOf(snapshot, match)
  const title = isCorrection ? messages.results.correctTitle : messages.results.walkoverTitle
  const intro = isCorrection ? messages.results.correctionIntro : messages.results.walkoverIntro
  return (
    <>
      <DialogHeader className="pr-6">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{intro}</DialogDescription>
      </DialogHeader>

      <div className="min-w-0 rounded-field bg-well px-3.5 py-2.5">
        <p className="truncate text-[0.8125rem] font-medium">
          {messages.common.versus(teamName(snapshot, sideTeamId(fixture, 'a')), teamName(snapshot, sideTeamId(fixture, 'b')))}
        </p>
        <p className="mt-0.5 text-[0.6875rem] text-muted-ink">{matchLabel(snapshot, match)}</p>
      </div>

      {isCorrection ? <CorrectionForm {...props} /> : <WalkoverForm {...props} />}
    </>
  )
}
