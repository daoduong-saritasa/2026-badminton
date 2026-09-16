import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { previewResultCorrection } from '@/data/impacts'
import { mutateTournament } from '@/data/tournament'
import { isWinningScore } from '@/domain/scoring'
import type { MutationImpact } from '@/domain/impacts'
import type { Score, TournamentSnapshot, UUID } from '@/domain/types'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { matchRoundLabel, pairName } from '@/features/tournament/MatchTicket'
import { ImpactPreview } from './ImpactPreview'

export interface ResultEditorProps {
  snapshot: TournamentSnapshot
  resetGeneration: number
  matchId: UUID
  onClose: () => void
}

type SaveAction =
  | { kind: 'score'; score: Score; previewTournamentVersion: number }
  | { kind: 'walkover'; winnerId: UUID }

// A preview describes one exact tournament version, so it must not outlive it.
// OrganizerPage remounts this subtree on every version and generation change,
// which discards the projection along with the rest of the form.
export function ResultEditor({ snapshot, resetGeneration, matchId, onClose }: ResultEditorProps) {
  const match = snapshot.matches.find((candidate) => candidate.id === matchId)
  const [scoreA, setScoreA] = useState(String(match?.score?.a ?? 21))
  const [scoreB, setScoreB] = useState(String(match?.score?.b ?? 0))
  const [walkoverWinner, setWalkoverWinner] = useState<UUID>(match?.winnerId ?? match?.pairAId ?? '')
  const [impact, setImpact] = useState<MutationImpact | null>(null)
  const [pendingWalkover, setPendingWalkover] = useState<UUID | null>(null)

  const previewMutation = useMutation({
    mutationFn: (score: Score) => previewResultCorrection(matchId, score, resetGeneration),
    onSuccess: setImpact,
  })

  const saveMutation = useMutation({
    mutationFn: async (action: SaveAction) => {
      if (!match) throw new Error('The selected match is no longer available')
      if (action.kind === 'walkover') {
        return mutateTournament('mark_walkover', {
          requestId: crypto.randomUUID(),
          resetGeneration,
          expectedVersion: match.version,
          payload: { matchId, winnerId: action.winnerId },
        })
      }
      if (match.state === 'completed') {
        return mutateTournament('correct_result', {
          requestId: crypto.randomUUID(),
          resetGeneration,
          expectedVersion: match.version,
          payload: { matchId, score: action.score, previewTournamentVersion: action.previewTournamentVersion },
        })
      }
      return mutateTournament('enter_result', {
        requestId: crypto.randomUUID(),
        resetGeneration,
        expectedVersion: match.version,
        payload: { matchId, score: action.score },
      })
    },
    onSuccess: () => {
      setImpact(null)
      setPendingWalkover(null)
      onClose()
    },
  })

  if (!match) {
    return <p className="text-[0.8125rem] text-muted-ink">The selected match is no longer available.</p>
  }

  const score = { a: Number(scoreA), b: Number(scoreB) }
  const scoreValid = Number.isInteger(score.a) && Number.isInteger(score.b) && isWinningScore(score)
  const isCorrection = match.state === 'completed'

  return (
    <section className="space-y-4">
      <header>
        <h3 className="text-sm font-semibold">
          {matchRoundLabel(match)} · {pairName(snapshot, match.pairAId)} vs {pairName(snapshot, match.pairBId)}
        </h3>
        <p className="mt-1 text-[0.6875rem] text-muted-ink">
          {isCorrection
            ? 'Correcting a completed result. Review the effects before confirming.'
            : 'Recording a result for a match played without live scoring.'}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="score-a">{pairName(snapshot, match.pairAId)}</Label>
          <Input id="score-a" type="number" inputMode="numeric" min="0" max="30" value={scoreA} onChange={(event) => setScoreA(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="score-b">{pairName(snapshot, match.pairBId)}</Label>
          <Input id="score-b" type="number" inputMode="numeric" min="0" max="30" value={scoreB} onChange={(event) => setScoreB(event.target.value)} />
        </div>
      </div>

      {!scoreValid ? (
        <p className="text-[0.6875rem] text-muted-ink">Use a completed badminton score: win by two from 21, capped at 30.</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button disabled={!scoreValid || previewMutation.isPending} onClick={() => previewMutation.mutate(score)}>
          {previewMutation.isPending ? 'Checking…' : isCorrection ? 'Review correction' : 'Review result'}
        </Button>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </div>

      {match.state === 'unstarted' ? (
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Select value={walkoverWinner} onValueChange={setWalkoverWinner}>
            <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="Walkover winner" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={match.pairAId as UUID}>{pairName(snapshot, match.pairAId)}</SelectItem>
              <SelectItem value={match.pairBId as UUID}>{pairName(snapshot, match.pairBId)}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" disabled={!walkoverWinner} onClick={() => setPendingWalkover(walkoverWinner)}>
            Record walkover
          </Button>
        </div>
      ) : null}

      {previewMutation.isError ? (
        <p className="text-sm text-destructive" role="alert">{previewMutation.error.message}</p>
      ) : null}
      {saveMutation.isError ? (
        <p className="text-sm text-destructive" role="alert">{saveMutation.error.message}</p>
      ) : null}

      <AlertDialog open={impact !== null} onOpenChange={(open) => { if (!open) setImpact(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isCorrection ? 'Correct this result?' : 'Record this result?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {impact?.blockedReason === null ? 'Review what changes before confirming.' : 'This change cannot be applied.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {impact ? <ImpactPreview impact={impact} matchId={matchId} /> : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={impact === null || impact.blockedReason !== null || saveMutation.isPending}
              onClick={() => {
                if (impact && impact.blockedReason === null) {
                  saveMutation.mutate({ kind: 'score', score, previewTournamentVersion: impact.tournamentVersion })
                }
              }}
            >
              {saveMutation.isPending ? 'Saving…' : 'Confirm change'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingWalkover !== null} onOpenChange={(open) => { if (!open) setPendingWalkover(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Record this walkover?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingWalkover ? `${pairName(snapshot, pendingWalkover)} advances without play. Earlier results are unchanged.` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pendingWalkover === null || saveMutation.isPending}
              onClick={() => { if (pendingWalkover) saveMutation.mutate({ kind: 'walkover', winnerId: pendingWalkover }) }}
            >
              {saveMutation.isPending ? 'Saving…' : 'Confirm walkover'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
