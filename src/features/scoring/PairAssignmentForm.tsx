import { useMutation } from '@tanstack/react-query'
import { mutateTournament } from '@/data/tournament'
import type { StaffRole, TournamentSnapshot, UUID } from '@/domain/types'
import { errorMessage } from '@/i18n/errors'
import { PairAssignmentView } from './PairAssignmentView'
import type { ComponentProps } from 'react'

type PairSaveInput = Parameters<ComponentProps<typeof PairAssignmentView>['onSave']>[0]

export function PairAssignmentForm({ snapshot, fixtureId, role, resetGeneration, onSaved }: {
  snapshot: TournamentSnapshot; fixtureId: UUID; role: StaffRole; resetGeneration: number; onSaved: () => void
}) {
  const mutation = useMutation({
    mutationFn: ({ input }: { input: PairSaveInput; complete: () => void }) => mutateTournament('assign_fixture_pairs', {
      requestId: crypto.randomUUID(), resetGeneration, expectedVersion: input.version,
      payload: { fixtureId: input.fixtureId, ruleException: input.ruleException,
        assignments: input.assignments.map(({ matchId, side, pair, matchVersion }) => ({ matchId, side, matchVersion, ...pair })),
      },
    }),
    onSuccess: (_receipt, { complete }) => { complete(); onSaved() },
  })
  return <PairAssignmentView snapshot={snapshot} fixtureId={fixtureId} role={role} onSave={(input, complete) => mutation.mutate({ input, complete })} pending={mutation.isPending} error={mutation.isError ? errorMessage(mutation.error) : null} />
}
