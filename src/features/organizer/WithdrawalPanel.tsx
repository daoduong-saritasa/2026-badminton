import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { previewWithdrawal } from '@/data/impacts'
import { mutateTournament } from '@/data/tournament'
import type { MutationImpact } from '@/domain/impacts'
import type { TournamentSnapshot, UUID } from '@/domain/types'
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
import { pairName, pairPlayers } from '@/features/tournament/MatchTicket'
import { errorMessage } from '@/i18n/errors'
import { messages } from '@/i18n/vi'
import { ImpactPreview } from './ImpactPreview'

export interface WithdrawalPanelProps {
  snapshot: TournamentSnapshot
  resetGeneration: number
}

// A preview is stored with the version it was built from and goes stale during
// render, so an unrelated mutation cannot leave a projection on screen that no
// longer describes what confirming would do.
export function WithdrawalPanel({ snapshot, resetGeneration }: WithdrawalPanelProps) {
  const [selectedPairId, setSelectedPairId] = useState<UUID | null>(null)
  const [reviewed, setReviewed] = useState<{ impact: MutationImpact; revision: number } | null>(null)

  const previewMutation = useMutation({
    mutationFn: (pairId: UUID) => previewWithdrawal(pairId, resetGeneration),
    onSuccess: (result) => setReviewed({ impact: result, revision: result.tournamentVersion }),
  })

  const withdrawMutation = useMutation({
    mutationFn: (input: { pairId: UUID; previewTournamentVersion: number }) =>
      mutateTournament('withdraw_pair', {
        requestId: crypto.randomUUID(),
        resetGeneration,
        expectedVersion: snapshot.tournament.version,
        payload: { pairId: input.pairId, previewTournamentVersion: input.previewTournamentVersion },
      }),
    onSuccess: () => {
      setReviewed(null)
      setSelectedPairId(null)
    },
  })

  const impact = reviewed && reviewed.revision === snapshot.tournament.resultRevision ? reviewed.impact : null
  const activePairs = snapshot.pairs.filter((pair) => !pair.withdrawn)
  const withdrawnPairs = snapshot.pairs.filter((pair) => pair.withdrawn)

  const review = (pairId: UUID) => {
    setSelectedPairId(pairId)
    previewMutation.mutate(pairId)
  }

  return (
    <section className="rounded-card border border-ink/5 bg-white p-6 shadow-card">
      <h3 className="text-sm font-semibold">{messages.withdrawals.heading}</h3>
      <p className="mt-1.5 text-[0.6875rem] text-muted-ink">
        {messages.withdrawals.description}
      </p>

      <ul className="mt-5 space-y-2">
        {activePairs.map((pair) => (
          <li key={pair.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ink/5 px-3 py-2">
            <span className="min-w-0">
              <span className="block truncate text-[0.8125rem] font-medium">{pairName(snapshot, pair.id)}</span>
              <span className="block truncate text-[0.6875rem] text-muted-ink">{pairPlayers(snapshot, pair.id)}</span>
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={previewMutation.isPending && selectedPairId === pair.id}
              onClick={() => review(pair.id)}
            >
              {previewMutation.isPending && selectedPairId === pair.id ? messages.common.checking : messages.withdrawals.review}
            </Button>
          </li>
        ))}
      </ul>

      {withdrawnPairs.length > 0 ? (
        <p className="mt-4 text-[0.6875rem] text-muted-ink">
          {messages.withdrawals.withdrawn(withdrawnPairs.map((pair) => pairName(snapshot, pair.id)).join(', '))}
        </p>
      ) : null}

      {previewMutation.isError ? (
        <p className="mt-4 text-sm text-destructive" role="alert">{errorMessage(previewMutation.error)}</p>
      ) : null}
      {withdrawMutation.isError ? (
        <p className="mt-4 text-sm text-destructive" role="alert">{errorMessage(withdrawMutation.error)}</p>
      ) : null}

      <AlertDialog open={impact !== null} onOpenChange={(open) => { if (!open) setReviewed(null) }}>
        <AlertDialogContent size="wide">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {selectedPairId
                ? messages.withdrawals.confirmTitle(pairName(snapshot, selectedPairId))
                : messages.withdrawals.confirmTitleFallback}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {impact?.blockedReason === null ? messages.withdrawals.consequence : messages.withdrawals.cannotApply}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {impact ? <ImpactPreview impact={impact} /> : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{messages.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={impact === null || impact.blockedReason !== null || selectedPairId === null || withdrawMutation.isPending}
              onClick={() => {
                if (impact && impact.blockedReason === null && selectedPairId) {
                  withdrawMutation.mutate({ pairId: selectedPairId, previewTournamentVersion: impact.tournamentVersion })
                }
              }}
            >
              {withdrawMutation.isPending ? messages.common.saving : messages.withdrawals.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
