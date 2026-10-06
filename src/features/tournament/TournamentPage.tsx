import { useState } from 'react'

import type { Court, FixtureMatch, TournamentSnapshot, UUID } from '@/domain/types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { messages } from '@/i18n/vi'

import {
  fixtureOf,
  fixtureScheduleLabel,
  isDeciderEligible,
  sideTeamId,
  teamName,
} from './labels'
import { MatchTicket } from './MatchTicket'
import { FixtureCard } from './FixtureCard'
import { MatchSummary } from './MatchSummary'
import { SeedLegend } from './Participants'

const courts: readonly Court[] = [1, 2]

function PlayingFixtures({ snapshot }: { snapshot: TournamentSnapshot }) {
  const playingIds = new Set(snapshot.matches.filter((match) => match.state === 'playing').map((match) => match.fixtureId))
  const fixtures = snapshot.fixtures.filter((fixture) => playingIds.has(fixture.id))
  if (fixtures.length === 0) return null
  return (
    <div className="border-l-4 border-orange bg-white px-4 py-3">
      <p className="text-sm font-semibold text-navy">{messages.matchState.playing}</p>
      <ul className="mt-2 space-y-2">
        {fixtures.map((fixture) => (
          <li className="text-sm [overflow-wrap:anywhere]" key={fixture.id}>
            <span className="font-semibold">{fixtureScheduleLabel(snapshot, fixture)}</span>
            <span className="mt-0.5 block text-muted-ink">{messages.common.versus(teamName(snapshot, fixture.teamAId), teamName(snapshot, fixture.teamBId))}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function teams(snapshot: TournamentSnapshot, match: FixtureMatch): string {
  const fixture = fixtureOf(snapshot, match)
  return messages.common.versus(teamName(snapshot, sideTeamId(fixture, 'a')), teamName(snapshot, sideTeamId(fixture, 'b')))
}

/** Snapshot order is fixture order then match number, which is the playing order. */
function waiting(snapshot: TournamentSnapshot): FixtureMatch[] {
  return snapshot.matches.filter((match) => match.state === 'unstarted' && isDeciderEligible(snapshot, match))
}

function currentMatch(snapshot: TournamentSnapshot, court: Court): FixtureMatch | undefined {
  return snapshot.matches.find((match) => match.state === 'playing' && match.court === court)
    ?? waiting(snapshot).find((match) => match.court === court)
}

function TeamSchedule({ snapshot, teamId }: { snapshot: TournamentSnapshot; teamId: UUID }) {
  const fixtures = snapshot.fixtures.filter((fixture) => fixture.teamAId === teamId || fixture.teamBId === teamId)
  return (
    <div>
      <h2 className="sr-only">{messages.publicView.teamSchedule(teamName(snapshot, teamId))}</h2>
      {fixtures.length === 0 ? (
        <p className="rounded-card border border-dashed border-rule bg-white/60 p-8 text-center text-sm text-muted-ink">{messages.publicView.noFixtures}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {fixtures.map((fixture) => <FixtureCard key={fixture.id} snapshot={snapshot} fixture={fixture} />)}
        </div>
      )}
    </div>
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
  const visibleIds = new Set(current.map((match) => match.id))
  const upcoming = isSetup ? [] : waiting(snapshot).filter((match) => !visibleIds.has(match.id))
  const completed = snapshot.matches
    .filter((match) => match.state === 'completed')
    .toReversed()
    .slice(0, 6)

  const nextLabel = (court: Court | null) => {
    const next = upcoming.find((match) => match.court === court)
    return next ? `${messages.common.fixtureMatch(fixtureScheduleLabel(snapshot, fixtureOf(snapshot, next)), next.matchNumber)} · ${teams(snapshot, next)}` : undefined
  }

  const filter = (
    <Select value={selectedTeamId ?? 'all'} onValueChange={(value) => setTeamFilter(value)}>
      <SelectTrigger className="w-full sm:w-64" aria-label={messages.publicView.teamFilter}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{messages.publicView.allTeams}</SelectItem>
        {snapshot.teams.map((team) => <SelectItem value={team.id} key={team.id}>{team.name}</SelectItem>)}
      </SelectContent>
    </Select>
  )

  if (selectedTeamId !== null) {
    return (
      <section className="view-enter space-y-6">
        {filter}
        <SeedLegend />
        {!isSetup ? <PlayingFixtures snapshot={snapshot} /> : null}
        <TeamSchedule snapshot={snapshot} teamId={selectedTeamId} />
      </section>
    )
  }

  return (
    <section className="view-enter space-y-6">
      {filter}
      <SeedLegend />
      <div>
        <div className="mb-4">
          <h2 className="text-lg font-semibold tracking-tight">{messages.publicView.playingNow}</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {current.map((match) => <MatchTicket match={match} snapshot={snapshot} nextLabel={nextLabel(match.court)} key={match.id} />)}
        </div>
        {current.length === 0 ? (
          <div className="rounded-card border border-dashed border-rule bg-white/60 px-6 py-10 text-center">
            <p className="text-sm font-semibold text-ink">
              {isSetup ? messages.publicView.setupInProgress : messages.publicView.noCourtMatches}
            </p>
          </div>
        ) : null}
      </div>
      {upcoming.length > 0 ? (
        <div>
          <h2 className="mb-3 text-lg font-semibold tracking-tight">{messages.publicView.upcoming}</h2>
          <ol className="grid gap-x-8 md:grid-cols-2">
            {upcoming.slice(0, 6).map((match) => (
              <li className="min-w-0" key={match.id}><MatchSummary snapshot={snapshot} match={match} compact /></li>
            ))}
          </ol>
        </div>
      ) : null}
      {completed.length > 0 ? (
        <div>
          <h2 className="mb-3 text-lg font-semibold tracking-tight">{messages.publicView.recentResults}</h2>
          <ol className="grid gap-x-8 md:grid-cols-2">
            {completed.map((match) => (
              <li className="min-w-0" key={match.id}><MatchSummary snapshot={snapshot} match={match} /></li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  )
}
