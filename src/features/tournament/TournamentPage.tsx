import type { Court, FixtureMatch, TournamentSnapshot } from '@/domain/types'
import { messages } from '@/i18n/vi'
import { cn } from '@/lib/utils'

import { fixtureOf, groupTone, isDeciderEligible, matchLabel, matchResultText, sideTeamId, teamName } from './labels'
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

function GroupChip({ snapshot, match }: { snapshot: TournamentSnapshot; match: FixtureMatch }) {
  const fixture = fixtureOf(snapshot, match)
  return (
    <span className={cn('rounded-pill px-2 py-0.5 text-[0.625rem] font-semibold', fixture?.group ? groupTone(fixture.group) : 'bg-well text-muted-ink')}>
      {matchLabel(snapshot, match)}
    </span>
  )
}

export function TournamentPage({ snapshot }: { snapshot: TournamentSnapshot }) {
  const current = courts
    .map((court) => currentMatch(snapshot, court))
    .filter((match): match is FixtureMatch => match !== undefined)
  const visibleIds = new Set(current.map((match) => match.id))
  const upcoming = waiting(snapshot).filter((match) => !visibleIds.has(match.id))
  const completed = snapshot.matches
    .filter((match) => match.state === 'completed')
    .toReversed()
    .slice(0, 6)

  const nextLabel = (court: Court | null) => {
    const next = upcoming.find((match) => match.court === court)
    return next ? teams(snapshot, next) : undefined
  }

  return (
    <section className="view-enter space-y-[2.125rem]">
      <div>
        <h2 className="mb-[1.125rem] text-sm font-medium">{messages.publicView.playingNow}</h2>
        <div className="grid gap-6 md:grid-cols-2">
          {current.map((match) => <MatchTicket match={match} snapshot={snapshot} nextLabel={nextLabel(match.court)} key={match.id} />)}
        </div>
        {current.length === 0 ? (
          <p className="rounded-card border border-dashed border-rule bg-white/60 p-8 text-center text-[0.8125rem] text-muted-ink">
            {messages.publicView.noCourtMatches}
          </p>
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
                  <GroupChip snapshot={snapshot} match={match} />
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
                  <GroupChip snapshot={snapshot} match={match} />
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
