import { useMutation } from '@tanstack/react-query'
import { mutateTournament } from '@/data/tournament'
import type { StaffRole, TournamentSnapshot, UUID } from '@/domain/types'
import { errorMessage } from '@/i18n/errors'
import { PairAssignmentView } from './PairAssignmentView'
import type { ComponentProps } from 'react'

export function PairAssignmentForm({ snapshot, fixtureId, role, resetGeneration, onSaved }: {
  snapshot: TournamentSnapshot; fixtureId: UUID; role: StaffRole; resetGeneration: number; onSaved: () => void
}) {
  const mutation = useMutation({
    mutationFn: (input: Parameters<ComponentProps<typeof PairAssignmentView>['onSave']>[0]) => mutateTournament('assign_fixture_pairs', {
      requestId: crypto.randomUUID(), resetGeneration, expectedVersion: input.version,
      payload: { fixtureId: input.fixtureId, ruleException: input.ruleException,
        assignments: input.assignments.map(({ matchId, side, pair, matchVersion }) => ({ matchId, side, matchVersion, ...pair })),
      },
    }),
    onSuccess: onSaved,
  })
  return <PairAssignmentView snapshot={snapshot} fixtureId={fixtureId} role={role} onSave={(input) => mutation.mutate(input)} pending={mutation.isPending} error={mutation.isError ? errorMessage(mutation.error) : null} />
}
