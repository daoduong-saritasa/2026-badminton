import { qualifyingCourtAssignments, qualifyingCourtLocked } from '@/domain/qualifying-schedule'
import { useMutation } from '@tanstack/react-query'

import { mutateTournament } from '@/data/tournament'
import type { Court, FixtureMatch, TournamentSnapshot } from '@/domain/types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { courtLabel } from '@/features/tournament/labels'
import { errorMessage } from '@/i18n/errors'
import { messages } from '@/i18n/messages'

const courts: readonly Court[] = [1, 2]

/** A match's court as a select; reports the chosen court without saving it. */
export function CourtSelectView({ snapshot, match, label, disabled = false, error = null, onChange }: {
  snapshot: TournamentSnapshot
  match: FixtureMatch
  /** Accessible name of the select. */
  label: string
  disabled?: boolean
  /** Message shown under the select. */
  error?: string | null
  onChange: (court: Court) => void
}) {
  return (
    <div>
      <Select
        value={match.court === null ? '' : String(match.court)}
        disabled={disabled}
        onValueChange={(value) => onChange(Number(value) as Court)}
      >
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue placeholder={messages.organizer.schedule.noCourt} />
        </SelectTrigger>
        <SelectContent>
          {courts.map((court) => <SelectItem value={String(court)} key={court}>{courtLabel(snapshot, court)}</SelectItem>)}
        </SelectContent>
      </Select>
      {error ? <p className="mt-2 text-xs text-destructive" role="alert">{error}</p> : null}
    </div>
  )
}

/** Saves a court choice; qualifying swaps both fixtures of the round. */
export function CourtSelect({ snapshot, match, resetGeneration, label }: {
  snapshot: TournamentSnapshot
  match: FixtureMatch
  resetGeneration: number
  /** Accessible name of the select. */
  label: string
}) {
  const fixture = snapshot.fixtures.find((candidate) => candidate.id === match.fixtureId)
  const qualifying = fixture?.stage === 'qualifying'
  const locked = qualifying && qualifyingCourtLocked(snapshot, fixture)
  const mutation = useMutation({
    mutationFn: (court: Court) => mutateTournament('assign_courts', {
      requestId: crypto.randomUUID(),
      resetGeneration,
      expectedVersion: snapshot.tournament.version,
      payload: { assignments: qualifyingCourtAssignments(snapshot, match, court) },
    }),
  })

  if (qualifying && (locked || match.matchNumber === 2)) {
    return <span className="text-xs text-muted-ink">{match.court ? courtLabel(snapshot, match.court) : messages.publicView.courtPending}</span>
  }

  return (
    <div>
      {qualifying ? <p className="mb-1 text-xs text-muted-ink">{messages.qualifying.swapCourts}</p> : null}
      <CourtSelectView
        snapshot={snapshot}
        match={match}
        label={label}
        disabled={mutation.isPending || locked}
        error={mutation.isError ? errorMessage(mutation.error) : null}
        onChange={(court) => mutation.mutate(court)}
      />
    </div>
  )
}
