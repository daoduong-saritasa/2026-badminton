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
import { ImpactPreview } from './ImpactPreview'

export interface WithdrawalPanelProps {
  snapshot: TournamentSnapshot
  resetGeneration: number
}

// Remounted by OrganizerPage on each version and generation change, so a
// preview cannot outlive the snapshot it describes.
export function WithdrawalPanel({ snapshot, resetGeneration }: WithdrawalPanelProps) {
  const [selectedPairId, setSelectedPairId] = useState<UUID | null>(null)
  const [impact, setImpact] = useState<MutationImpact | null>(null)

  const previewMutation = useMutation({
    mutationFn: (pairId: UUID) => previewWithdrawal(pairId, resetGeneration),
    onSuccess: setImpact,
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
      setImpact(null)
      setSelectedPairId(null)
    },
  })

  const activePairs = snapshot.pairs.filter((pair) => !pair.withdrawn)
  const withdrawnPairs = snapshot.pairs.filter((pair) => pair.withdrawn)

  const review = (pairId: UUID) => {
    setSelectedPairId(pairId)
    previewMutation.mutate(pairId)
  }

  return (
    <section className="rounded-card border border-ink/5 bg-white p-6 shadow-card">
      <h3 className="text-sm font-semibold">Pair withdrawals</h3>
      <p className="mt-1.5 text-[0.6875rem] text-muted-ink">
        Withdrawing voids a pair's group matches and recalculates standings. Review the effects before confirming.
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
              {previewMutation.isPending && selectedPairId === pair.id ? 'Checking…' : 'Review withdrawal'}
            </Button>
          </li>
        ))}
      </ul>

      {withdrawnPairs.length > 0 ? (
        <p className="mt-4 text-[0.6875rem] text-muted-ink">
          Withdrawn: {withdrawnPairs.map((pair) => pairName(snapshot, pair.id)).join(', ')}
        </p>
      ) : null}

      {previewMutation.isError ? (
        <p className="mt-4 text-sm text-destructive" role="alert">{previewMutation.error.message}</p>
      ) : null}
      {withdrawMutation.isError ? (
        <p className="mt-4 text-sm text-destructive" role="alert">{withdrawMutation.error.message}</p>
      ) : null}

      <AlertDialog open={impact !== null} onOpenChange={(open) => { if (!open) setImpact(null) }}>
        <AlertDialogContent size="wide">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {selectedPairId ? `Withdraw ${pairName(snapshot, selectedPairId)}?` : 'Withdraw this pair?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {impact?.blockedReason === null
                ? 'Their group matches are voided and standings are recalculated.'
                : 'This withdrawal cannot be applied.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {impact ? <ImpactPreview impact={impact} /> : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={impact === null || impact.blockedReason !== null || selectedPairId === null || withdrawMutation.isPending}
              onClick={() => {
                if (impact && impact.blockedReason === null && selectedPairId) {
                  withdrawMutation.mutate({ pairId: selectedPairId, previewTournamentVersion: impact.tournamentVersion })
                }
              }}
            >
              {withdrawMutation.isPending ? 'Saving…' : 'Confirm withdrawal'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
