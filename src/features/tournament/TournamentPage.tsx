import { useState } from 'react'

import type { Court, FixtureMatch, Side, TeamFixture, TournamentSnapshot, UUID } from '@/domain/types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { messages } from '@/i18n/vi'

import {
  fixtureLabel,
  fixtureMatches,
  fixtureOf,
  fixtureScore,
  isDeciderEligible,
  isDrawnFixture,
  matchLabel,
  matchResultText,
  pairPlayers,
  scoreText,
  sideTeamId,
  teamName,
} from './labels'
import { MatchTicket } from './MatchTicket'

const courts: readonly Court[] = [1, 2]

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

function StageChip({ snapshot, match }: { snapshot: TournamentSnapshot; match: FixtureMatch }) {
  return (
    <span className="rounded-pill bg-well px-2 py-0.5 text-[0.625rem] font-semibold text-muted-ink">
      {matchLabel(snapshot, match)}
    </span>
  )
}

/**
 * One team's fixtures in playing order. Pairs come only from match rows, which
 * the server creates once lineups are revealed, so the filter never shows a
 * pair before the reveal.
 */
function TeamSchedule({ snapshot, teamId }: { snapshot: TournamentSnapshot; teamId: UUID }) {
  const fixtures = snapshot.fixtures.filter((fixture) => fixture.teamAId === teamId || fixture.teamBId === teamId)
  const ownSide = (fixture: TeamFixture): Side => (fixture.teamAId === teamId ? 'a' : 'b')
  const otherSide = (fixture: TeamFixture): Side => (ownSide(fixture) === 'a' ? 'b' : 'a')

  return (
    <div>
      <h2 className="mb-[1.125rem] text-sm font-medium">{messages.publicView.teamSchedule(teamName(snapshot, teamId))}</h2>
      {fixtures.length === 0 ? (
        <p className="rounded-card border border-dashed border-rule bg-white/60 p-8 text-center text-[0.8125rem] text-muted-ink">
          {messages.publicView.noFixtures}
        </p>
      ) : (
        <ol className="rounded-card border border-ink/5 bg-white px-5 shadow-card">
          {fixtures.map((fixture) => {
            const matches = fixtureMatches(snapshot, fixture.id)
            const score = fixtureScore(snapshot, fixture.id)
            return (
              <li className="border-t border-hairline py-4 first:border-t-0" key={fixture.id}>
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <span className="flex min-w-0 flex-wrap items-center gap-2.5">
                    <span className="rounded-pill bg-well px-2 py-0.5 text-[0.625rem] font-semibold text-muted-ink">{fixtureLabel(fixture)}</span>
                    <span className="min-w-0 text-[0.8125rem] font-medium [overflow-wrap:anywhere]">
                      {messages.publicView.opponent(teamName(snapshot, sideTeamId(fixture, otherSide(fixture))))}
                    </span>
                  </span>
                  {matches.some((match) => match.state === 'completed') ? (
                    <span className="numeric text-xs font-semibold">
                      {scoreText({ a: score[ownSide(fixture)], b: score[otherSide(fixture)] })}
                      {isDrawnFixture(snapshot, fixture) ? ` · ${messages.fixtures.drawn}` : ''}
                    </span>
                  ) : null}
                </div>
                {matches.length === 0 ? (
                  <p className="mt-2 text-[0.6875rem] text-muted-ink">{messages.fixtures.matchesPending}</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {matches.filter((match) => isDeciderEligible(snapshot, match)).map((match) => {
                      const own = ownSide(fixture) === 'a' ? match.pairA : match.pairB
                      const other = ownSide(fixture) === 'a' ? match.pairB : match.pairA
                      return (
                        <li className="grid gap-0.5 text-[0.6875rem]" key={match.id}>
                          <span className="flex flex-wrap justify-between gap-2">
                            <span className="font-semibold">
                              {messages.common.matchNumber(match.matchNumber)}
                              {' · '}
                              {match.court ? messages.common.court(match.court) : messages.publicView.courtPending}
                            </span>
                            <span className="text-muted-ink">{matchResultText(snapshot, match)}</span>
                          </span>
                          <span className="text-muted-ink [overflow-wrap:anywhere]">
                            {messages.common.versus(pairPlayers(snapshot, own), pairPlayers(snapshot, other))}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

export function TournamentPage({ snapshot }: { snapshot: TournamentSnapshot }) {
  const [teamFilter, setTeamFilter] = useState<UUID | 'all'>('all')
  const selectedTeamId = snapshot.teams.some((team) => team.id === teamFilter) ? teamFilter : null
  const current = courts
    .map((court) => currentMatch(snapshot, court))
    .filter((match): match is FixtureMatch => match !== undefined)
  const visibleIds = new Set(current.map((match) => match.id))
  const upcoming = waiting(snapshot).filter((match) => !visibleIds.has(match.id))
  const completed = snapshot.matches
    .filter((match) => match.state === 'completed')
    .toReversed()
    .slice(0, 6)
  const isSetup = snapshot.tournament.stage === 'setup'

  const nextLabel = (court: Court | null) => {
    const next = upcoming.find((match) => match.court === court)
    return next ? teams(snapshot, next) : undefined
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
      <section className="view-enter space-y-[2.125rem]">
        {filter}
        <TeamSchedule snapshot={snapshot} teamId={selectedTeamId} />
      </section>
    )
  }

  return (
    <section className="view-enter space-y-[2.125rem]">
      {filter}
      <div>
        <h2 className="mb-[1.125rem] text-sm font-medium">{messages.publicView.playingNow}</h2>
        <div className="grid gap-6 md:grid-cols-2">
          {current.map((match) => <MatchTicket match={match} snapshot={snapshot} nextLabel={nextLabel(match.court)} key={match.id} />)}
        </div>
        {current.length === 0 ? (
          <div className="rounded-card border border-dashed border-rule bg-white/60 px-6 py-10 text-center">
            <p className="text-sm font-semibold text-ink">
              {isSetup ? messages.publicView.setupInProgress : messages.publicView.noCourtMatches}
            </p>
            {isSetup ? <p className="mx-auto mt-2 max-w-md text-xs/[1.6] text-muted-ink">{messages.publicView.setupInProgressDescription}</p> : null}
          </div>
        ) : null}
      </div>
      {upcoming.length > 0 ? (
        <div>
          <h2 className="mb-[1.125rem] text-sm font-medium">{messages.publicView.upcoming}</h2>
          <ol className="rounded-card border border-ink/5 bg-white px-5 shadow-card">
            {upcoming.slice(0, 6).map((match) => (
              <li className="grid gap-x-3 gap-y-1.5 border-t border-hairline py-4 text-xs first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={match.id}>
                <span className="min-w-0 [overflow-wrap:anywhere] font-medium">{teams(snapshot, match)}</span>
                <span className="flex flex-wrap items-center gap-2.5 text-[0.6875rem] text-muted-ink">
                  <StageChip snapshot={snapshot} match={match} />
                  {match.court ? messages.common.court(match.court) : messages.publicView.courtPending}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {completed.length > 0 ? (
        <div>
          <h2 className="mb-[1.125rem] text-sm font-medium">{messages.publicView.recentResults}</h2>
          <ol className="rounded-card border border-ink/5 bg-white px-5 shadow-card">
            {completed.map((match) => (
              <li className="grid gap-1 border-t border-hairline py-4 text-xs first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-3" key={match.id}>
                <span className="min-w-0 [overflow-wrap:anywhere] font-medium">{teams(snapshot, match)}</span>
                <span className="flex flex-wrap items-center gap-2.5 text-muted-ink">
                  <StageChip snapshot={snapshot} match={match} />
                  {matchResultText(snapshot, match)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  )
}
