import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { mutateTournament } from '@/data/tournament'
import { isWinningScore } from '@/domain/scoring'
import type { Match, Score, TournamentSnapshot, UUID } from '@/domain/types'
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
import { pairName } from '@/features/tournament/MatchTicket'

type PendingAction =
  | { kind: 'score'; match: Match; score: Score }
  | { kind: 'walkover'; match: Match; winnerId: UUID }
  | { kind: 'withdraw'; pairId: UUID }
  | null

function editableResultMatches(snapshot: TournamentSnapshot): Match[] {
  return snapshot.matches.filter((match) =>
    (match.state === 'unstarted' || match.state === 'completed')
      && match.pairAId !== null
      && match.pairBId !== null,
  )
}

function correctionBlocked(snapshot: TournamentSnapshot, match: Match): boolean {
  if (match.state !== 'completed') return false
  if (match.round === 'group') {
    return snapshot.matches.some((candidate) => candidate.round !== 'group' && candidate.state !== 'unstarted')
  }
  if (match.round === 'semifinal') {
    return snapshot.matches.some((candidate) => candidate.round === 'final' && candidate.state !== 'unstarted')
  }
  return false
}

export function ResultEditor({ snapshot }: { snapshot: TournamentSnapshot }) {
  const matches = useMemo(() => editableResultMatches(snapshot), [snapshot])
  const [matchId, setMatchId] = useState(matches[0]?.id ?? '')
  const match = matches.find((candidate) => candidate.id === matchId) ?? matches[0]
  const [scoreA, setScoreA] = useState('21')
  const [scoreB, setScoreB] = useState('0')
  const [walkoverWinner, setWalkoverWinner] = useState<UUID>('')
  const [pending, setPending] = useState<PendingAction>(null)

  const selectMatch = (nextMatchId: string) => {
    const nextMatch = matches.find((candidate) => candidate.id === nextMatchId)
    setMatchId(nextMatchId)
    setScoreA(String(nextMatch?.score?.a ?? 21))
    setScoreB(String(nextMatch?.score?.b ?? 0))
    setWalkoverWinner(nextMatch?.winnerId ?? nextMatch?.pairAId ?? '')
  }

  const resultMutation = useMutation({
    mutationFn: async (action: Exclude<PendingAction, null>) => {
      if (action.kind === 'withdraw') {
        return mutateTournament('withdraw_pair', {
          requestId: crypto.randomUUID(),
          expectedVersion: snapshot.tournament.version,
          payload: { pairId: action.pairId },
        })
      }
      if (action.kind === 'walkover') {
        return mutateTournament('mark_walkover', {
          requestId: crypto.randomUUID(),
          expectedVersion: action.match.version,
          payload: { matchId: action.match.id, winnerId: action.winnerId },
        })
      }
      const operation = action.match.state === 'completed' ? 'correct_result' : 'enter_result'
      return mutateTournament(operation, {
        requestId: crypto.randomUUID(),
        expectedVersion: action.match.version,
        payload: { matchId: action.match.id, score: action.score },
      })
    },
    onSuccess: () => setPending(null),
  })

  const score = { a: Number(scoreA), b: Number(scoreB) }
  const scoreValid = Number.isInteger(score.a) && Number.isInteger(score.b) && isWinningScore(score)
  const activePairs = snapshot.pairs.filter((pair) => !pair.withdrawn)
  const withdrawalBlocked = snapshot.matches.some((candidate) => candidate.round !== 'group' && candidate.state !== 'unstarted')
  const blocked = match ? correctionBlocked(snapshot, match) : false

  return (
    <section className="rounded-[1.375rem] border bg-white p-5 shadow-[0_6px_0_rgb(15_43_41/0.03)]">
      <h3 className="text-base font-semibold">Results and withdrawals</h3>
      <p className="mt-1 text-xs text-muted-foreground">Enter an unstarted result or look up a completed match to correct it.</p>

      {match ? (
        <div className="mt-5 space-y-4">
          <div className="space-y-2">
            <Label>Match</Label>
            <Select value={match.id} onValueChange={selectMatch}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {matches.map((candidate) => (
                  <SelectItem value={candidate.id} key={candidate.id}>
                    {candidate.round} · {pairName(snapshot, candidate.pairAId)} vs {pairName(snapshot, candidate.pairBId)} · {candidate.state}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="score-a">{pairName(snapshot, match.pairAId)}</Label>
              <Input id="score-a" type="number" min="0" max="30" value={scoreA} onChange={(event) => setScoreA(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="score-b">{pairName(snapshot, match.pairBId)}</Label>
              <Input id="score-b" type="number" min="0" max="30" value={scoreB} onChange={(event) => setScoreB(event.target.value)} />
            </div>
          </div>
          {blocked ? <p className="text-xs text-destructive">Downstream play has started, so this result can no longer change.</p> : null}
          {!scoreValid ? <p className="text-xs text-muted-foreground">Use a completed badminton score: win by two from 21, capped at 30.</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button disabled={!scoreValid || blocked} onClick={() => setPending({ kind: 'score', match, score })}>
              {match.state === 'completed' ? 'Review correction' : 'Review direct result'}
            </Button>
            {match.state === 'unstarted' ? (
              <>
                <Select value={walkoverWinner} onValueChange={setWalkoverWinner}>
                  <SelectTrigger className="w-48"><SelectValue placeholder="Walkover winner" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={match.pairAId as UUID}>{pairName(snapshot, match.pairAId)}</SelectItem>
                    <SelectItem value={match.pairBId as UUID}>{pairName(snapshot, match.pairBId)}</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" disabled={!walkoverWinner} onClick={() => setPending({ kind: 'walkover', match, winnerId: walkoverWinner })}>
                  Review walkover
                </Button>
              </>
            ) : null}
          </div>
        </div>
      ) : <p className="mt-5 text-sm text-muted-foreground">No result is available to edit.</p>}

      <div className="mt-6 border-t pt-5">
        <Label>Withdraw an active pair</Label>
        <div className="mt-2 flex flex-wrap gap-2">
          {activePairs.map((pair) => (
            <Button
              variant="outline"
              size="sm"
              disabled={withdrawalBlocked}
              key={pair.id}
              onClick={() => setPending({ kind: 'withdraw', pairId: pair.id })}
            >
              {pairName(snapshot, pair.id)}
            </Button>
          ))}
        </div>
        {withdrawalBlocked ? <p className="mt-2 text-xs text-muted-foreground">Withdrawals close when knockout play starts.</p> : null}
      </div>

      {resultMutation.isError ? <p className="mt-4 text-sm text-destructive" role="alert">{resultMutation.error.message}</p> : null}
      <AlertDialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === 'withdraw' ? 'Withdraw this pair?' : pending?.kind === 'walkover' ? 'Record this walkover?' : pending?.kind === 'score' && pending.match.state === 'completed' ? 'Correct this result?' : 'Record this result?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === 'withdraw'
                ? 'Their group matches will be voided and standings will be recalculated.'
                : 'This changes standings and may determine downstream participants.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={resultMutation.isPending || pending === null} onClick={() => { if (pending) resultMutation.mutate(pending) }}>
              {resultMutation.isPending ? 'Saving…' : 'Confirm change'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
