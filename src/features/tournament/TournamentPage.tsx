import { useState } from 'react'

import type { Court, FixtureMatch, TournamentSnapshot, UUID } from '@/domain/types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { messages } from '@/i18n/messages'

import { isDeciderEligible } from './labels'
import { MatchTicket } from './MatchTicket'
import { FixtureCard } from './FixtureCard'
import { SeedLegend } from './Participants'
import { QualificationPlayoffs } from './QualificationPlayoffs'

const courts: readonly Court[] = [1, 2]

/** Snapshot order is fixture order then match number, which is the playing order. */
function waiting(snapshot: TournamentSnapshot): FixtureMatch[] {
  return snapshot.matches.filter((match) => match.state === 'unstarted' && isDeciderEligible(snapshot, match))
}

function currentMatch(snapshot: TournamentSnapshot, court: Court): FixtureMatch | undefined {
  return snapshot.matches.find((match) => match.state === 'playing' && match.court === court)
    ?? waiting(snapshot).find((match) => match.court === court)
}

/** Qualifying fixtures, then the qualification playoff rounds, for one team or all. */
function FixtureList({ snapshot, teamId }: { snapshot: TournamentSnapshot; teamId: UUID | null }) {
  const qualifying = snapshot.fixtures.filter((fixture) =>
    fixture.stage === 'qualifying' && (teamId === null || fixture.teamAId === teamId || fixture.teamBId === teamId))
  return (
    <>
      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">{messages.fixtures.qualifyingHeading}</h2>
        {qualifying.length === 0 ? (
          <p className="rounded-card border border-dashed border-rule bg-white/60 p-8 text-center text-sm text-muted-ink">{messages.publicView.noFixtures}</p>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {qualifying.map((fixture) => <FixtureCard key={fixture.id} snapshot={snapshot} fixture={fixture} />)}
          </div>
        )}
      </section>
      <QualificationPlayoffs snapshot={snapshot} teamId={teamId} />
    </>
  )
}

export function TournamentPage({ snapshot }: { snapshot: TournamentSnapshot }) {
  const [teamFilter, setTeamFilter] = useState<UUID | 'all'>('all')
  const selectedTeamId = snapshot.teams.some((team) => team.id === teamFilter) ? teamFilter : null
  const isSetup = snapshot.tournament.stage === 'setup'
  // Courts survive a progress reset, so during setup they describe no real schedule.
  const current = isSetup ? [] : courts
    .map((court) => currentMatch(snapshot, court))
    .filter((match): match is FixtureMatch => match !== undefined)

  return (
    <section className="view-enter space-y-6">
      <Select value={selectedTeamId ?? 'all'} onValueChange={(value) => setTeamFilter(value)}>
        <SelectTrigger className="w-full sm:w-64" aria-label={messages.publicView.teamFilter}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{messages.publicView.allTeams}</SelectItem>
          {snapshot.teams.map((team) => <SelectItem value={team.id} key={team.id}>{team.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <SeedLegend />
      {selectedTeamId === null ? (
        <section>
          <h2 className="mb-4 text-lg font-semibold tracking-tight">{messages.publicView.playingNow}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {current.map((match) => <MatchTicket match={match} snapshot={snapshot} key={match.id} />)}
          </div>
          {current.length === 0 ? (
            <div className="rounded-card border border-dashed border-rule bg-white/60 px-6 py-10 text-center">
              <p className="text-sm font-semibold text-ink">
                {isSetup ? messages.publicView.setupInProgress : messages.publicView.noCourtMatches}
              </p>
            </div>
          ) : null}
        </section>
      ) : null}
      <FixtureList snapshot={snapshot} teamId={selectedTeamId} />
    </section>
  )
}
