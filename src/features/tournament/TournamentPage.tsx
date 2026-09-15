import { Clock3 } from 'lucide-react'

import type { Match, TournamentSnapshot } from '@/domain/types'
import { availableCourts } from '@/domain/setup'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

import { cn } from '@/lib/utils'

import { groupTone, MatchTicket, pairName } from './MatchTicket'

function currentMatch(matches: Match[], court: 1 | 2): Match | undefined {
  const onCourt = matches.filter((match) => match.court === court && match.state !== 'completed' && match.state !== 'void')
  return onCourt.find((match) => match.state === 'playing') ?? onCourt.sort((a, b) => a.playingOrder - b.playingOrder)[0]
}

export function TournamentPage({ snapshot }: { snapshot: TournamentSnapshot }) {
  const courts = availableCourts(snapshot.tournament.courtCount)
  const current = courts.map((court) => currentMatch(snapshot.matches, court)).filter((match): match is Match => match !== undefined)
  const visibleIds = new Set(current.map((match) => match.id))
  const upcoming = snapshot.matches
    .filter((match) => match.state === 'unstarted' && !visibleIds.has(match.id))
    .sort((a, b) => a.playingOrder - b.playingOrder)
  const allGroupsFinished = snapshot.matches.some((match) => match.round === 'group')
    && snapshot.matches.filter((match) => match.round === 'group').every((match) => match.state === 'completed' || match.state === 'void')

  const completed = snapshot.matches
    .filter((match) => match.state === 'completed')
    .toSorted((first, second) => second.playingOrder - first.playingOrder)
    .slice(0, 6)

  const nextLabel = (court: 1 | 2) => {
    const next = upcoming.find((match) => match.court === court)
    return next ? `${pairName(snapshot, next.pairAId)} vs ${pairName(snapshot, next.pairBId)}` : undefined
  }

  return (
    <section className="view-enter space-y-[2.125rem]">
      {allGroupsFinished && snapshot.tournament.stage === 'groups' ? (
        <Alert className="rounded-card border-line bg-white">
          <Clock3 />
          <AlertTitle>Waiting for group confirmation</AlertTitle>
          <AlertDescription>The organizer must review ties and confirm the semifinal pairs.</AlertDescription>
        </Alert>
      ) : null}
      <div>
        <h2 className="mb-[1.125rem] text-sm font-medium">Playing now</h2>
        <div className="grid gap-6 md:grid-cols-2">
          {current.map((match) => <MatchTicket match={match} snapshot={snapshot} nextLabel={match.court ? nextLabel(match.court) : undefined} key={match.id} />)}
        </div>
        {current.length === 0 ? (
          <p className="rounded-card border border-dashed border-rule bg-white/60 p-8 text-center text-[0.8125rem] text-muted-ink">
            No matches are assigned to a court yet.
          </p>
        ) : null}
      </div>
      {upcoming.length > 0 ? (
        <div>
          <h2 className="mb-[1.125rem] text-sm font-medium">Upcoming order</h2>
          <ol className="rounded-card border border-ink/5 bg-white px-5 shadow-card">
            {upcoming.slice(0, 6).map((match) => (
              <li className="grid grid-cols-[1.625rem_minmax(0,1fr)_auto] items-center gap-3 border-t border-hairline py-4 text-xs first:border-t-0" key={match.id}>
                <span className="numeric text-[0.625rem] text-dim-ink">{String(match.playingOrder).padStart(2, '0')}</span>
                <span className="truncate font-medium">
                  {pairName(snapshot, match.pairAId)}<span className="px-1 text-muted-ink">vs</span>{pairName(snapshot, match.pairBId)}
                </span>
                <span className="flex shrink-0 items-center gap-2.5 text-[0.6875rem] text-muted-ink">
                  {match.group ? (
                    <span className={cn('rounded-pill px-2 py-0.5 text-[0.625rem] font-semibold', groupTone(match.group))}>
                      {match.group}
                    </span>
                  ) : null}
                  {match.court ? `Court ${match.court}` : 'Court pending'}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {completed.length > 0 ? (
        <div>
          <h2 className="mb-[1.125rem] text-sm font-medium">Recent results</h2>
          <ol className="rounded-card border border-ink/5 bg-white px-5 shadow-card">
            {completed.map((match) => (
              <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-hairline py-4 text-xs first:border-t-0" key={match.id}>
                <span className="min-w-0 truncate font-medium">{pairName(snapshot, match.pairAId)} vs {pairName(snapshot, match.pairBId)}</span>
                <span className="shrink-0 text-muted-ink">Court {match.court ?? '–'} · {match.score ? `${match.score.a}–${match.score.b}` : 'Walkover'}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  )
}
