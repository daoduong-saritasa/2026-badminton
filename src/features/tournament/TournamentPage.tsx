import { courtQueue, qualifyingFixtures, qualifyingRound } from '@/domain/qualifying-schedule'
import { useState } from 'react'

import type { Court, TournamentSnapshot, UUID } from '@/domain/types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { messages } from '@/i18n/messages'

import { courtLabel, isDeciderEligible, matchLabel, sideTeamId, teamName } from './labels'
import { MatchTicket } from './MatchTicket'
import { FixtureCard } from './FixtureCard'
import { SeedLegend } from './Participants'
import { QualificationPlayoffs } from './QualificationPlayoffs'

const courts: readonly Court[] = [1, 2]

/** Qualifying fixtures, then the qualification playoff rounds, for one team or all. */
function FixtureList({ snapshot, teamId }: { snapshot: TournamentSnapshot; teamId: UUID | null }) {
  const qualifying = qualifyingFixtures(snapshot).filter((fixture) =>
    teamId === null || fixture.teamAId === teamId || fixture.teamBId === teamId)
  return (
    <>
      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">{messages.fixtures.qualifyingHeading}</h2>
        {qualifying.length === 0 ? (
          <p className="rounded-card border border-dashed border-rule bg-white/60 p-8 text-center text-sm text-muted-ink">{messages.publicView.noFixtures}</p>
        ) : (
          <div className="space-y-6">
            {[1, 2, 3].map((round) => {
              const fixtures = qualifying.filter((fixture) => qualifyingRound(fixture) === round)
                .toSorted((a, b) => (a.qualifyingCourt ?? 0) - (b.qualifyingCourt ?? 0))
              if (fixtures.length === 0) return null
              return (
                <section className="space-y-3" key={round} aria-label={messages.qualifying.round(round)}>
                  <h3 className="text-sm font-semibold text-muted-ink">{messages.qualifying.round(round)}</h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    {fixtures.map((fixture) => <FixtureCard key={fixture.id} snapshot={snapshot} fixture={fixture}
                      label={fixture.qualifyingCourt ? courtLabel(snapshot, fixture.qualifyingCourt) : messages.publicView.courtPending} />)}
                  </div>
                </section>
              )
            })}
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
  const queues = courts.map((court) => {
    const qualifying = courtQueue(snapshot, court)
    const current = qualifying.current ?? (isSetup ? undefined : snapshot.matches.find((match) => match.court === court
      && (match.state === 'playing' || (match.state === 'unstarted' && isDeciderEligible(snapshot, match)))
      && snapshot.fixtures.some((fixture) => fixture.id === match.fixtureId && fixture.stage !== 'qualifying')))
    return { court, current, next: qualifying.next }
  })

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
            {queues.filter((queue) => queue.current || queue.next).map(({ court, current, next }) => (
              <div className="min-w-0 space-y-2" key={court}>
                {current ? <MatchTicket match={current} snapshot={snapshot} /> : (
                  <div className="rounded-card border border-line bg-white p-5">
                    <h3 className="font-semibold">{courtLabel(snapshot, court)}</h3>
                    <p className="mt-2 text-sm text-muted-ink">{messages.qualifying.waiting}</p>
                  </div>
                )}
                {next ? <p className="px-1 text-xs leading-relaxed text-muted-ink [overflow-wrap:anywhere]">
                  <strong className="font-semibold">{messages.qualifying.next}: </strong>
                  {matchLabel(snapshot, next)} · {messages.common.versus(
                    teamName(snapshot, sideTeamId(snapshot.fixtures.find((fixture) => fixture.id === next.fixtureId), 'a')),
                    teamName(snapshot, sideTeamId(snapshot.fixtures.find((fixture) => fixture.id === next.fixtureId), 'b')))}
                </p> : null}
              </div>
            ))}
          </div>
          {queues.every((queue) => !queue.current && !queue.next) ? (
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
