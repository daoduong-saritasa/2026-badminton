import { useMutation } from '@tanstack/react-query'

import { mutateTournament } from '@/data/tournament'
import type { Court, FixtureMatch, TournamentSnapshot } from '@/domain/types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { courtLabel } from '@/features/tournament/labels'
import { errorMessage } from '@/i18n/errors'
import { messages } from '@/i18n/vi'

const courts: readonly Court[] = [1, 2]

/** Moves an unstarted match to another court; a choice saves at once. */
export function CourtSelect({ snapshot, match, resetGeneration, label }: {
  snapshot: TournamentSnapshot
  match: FixtureMatch
  resetGeneration: number
  /** Accessible name of the select. */
  label: string
}) {
  const mutation = useMutation({
    mutationFn: (court: Court) => mutateTournament('assign_courts', {
      requestId: crypto.randomUUID(),
      resetGeneration,
      expectedVersion: snapshot.tournament.version,
      payload: { assignments: [{ matchId: match.id, court }] },
    }),
  })

  return (
    <div>
      <Select
        value={match.court === null ? '' : String(match.court)}
        disabled={mutation.isPending}
        onValueChange={(value) => mutation.mutate(Number(value) as Court)}
      >
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue placeholder={messages.organizer.schedule.noCourt} />
        </SelectTrigger>
        <SelectContent>
          {courts.map((court) => <SelectItem value={String(court)} key={court}>{courtLabel(snapshot, court)}</SelectItem>)}
        </SelectContent>
      </Select>
      {mutation.isError ? <p className="mt-2 text-xs text-destructive" role="alert">{errorMessage(mutation.error)}</p> : null}
    </div>
  )
}
