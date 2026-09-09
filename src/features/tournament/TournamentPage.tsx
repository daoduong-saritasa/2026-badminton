import { Clock3 } from 'lucide-react'

import type { Match, TournamentSnapshot } from '@/domain/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

import { MatchTicket, pairName } from './MatchTicket'

function currentMatch(matches: Match[], court: 1 | 2): Match | undefined {
  const onCourt = matches.filter((match) => match.court === court && match.state !== 'completed' && match.state !== 'void')
  return onCourt.find((match) => match.state === 'playing') ?? onCourt.sort((a, b) => a.playingOrder - b.playingOrder)[0]
}

export function TournamentPage({ snapshot }: { snapshot: TournamentSnapshot }) {
  const courtOne = currentMatch(snapshot.matches, 1)
  const courtTwo = currentMatch(snapshot.matches, 2)
  const visibleIds = new Set([courtOne?.id, courtTwo?.id])
  const upcoming = snapshot.matches
    .filter((match) => match.state === 'unstarted' && !visibleIds.has(match.id))
    .sort((a, b) => a.playingOrder - b.playingOrder)
  const allGroupsFinished = snapshot.matches.some((match) => match.round === 'group')
    && snapshot.matches.filter((match) => match.round === 'group').every((match) => match.state === 'completed' || match.state === 'void')

  const nextLabel = (court: 1 | 2) => {
    const next = upcoming.find((match) => match.court === court)
    return next ? `${pairName(snapshot, next.pairAId)} vs ${pairName(snapshot, next.pairBId)}` : undefined
  }

  return (
    <section className="view-enter space-y-7">
      {allGroupsFinished && snapshot.tournament.stage === 'groups' ? (
        <Alert className="bg-white">
          <Clock3 />
          <AlertTitle>Waiting for group confirmation</AlertTitle>
          <AlertDescription>The organizer must review ties and confirm the semifinal pairs.</AlertDescription>
        </Alert>
      ) : null}
      <div>
        <h2 className="mb-4 text-sm font-semibold">Playing now</h2>
        <div className="grid gap-5 md:grid-cols-2">
          {courtOne ? <MatchTicket match={courtOne} snapshot={snapshot} nextLabel={nextLabel(1)} /> : null}
          {courtTwo ? <MatchTicket match={courtTwo} snapshot={snapshot} nextLabel={nextLabel(2)} /> : null}
        </div>
        {!courtOne && !courtTwo ? (
          <p className="rounded-2xl border border-dashed bg-white/60 p-8 text-center text-sm text-muted-foreground">
            No matches are assigned to a court yet.
          </p>
        ) : null}
      </div>
      {upcoming.length > 0 ? (
        <div>
          <h2 className="mb-3 text-sm font-semibold">Upcoming order</h2>
          <ol className="divide-y rounded-2xl border bg-white px-5">
            {upcoming.slice(0, 6).map((match) => (
              <li className="flex items-center justify-between gap-4 py-4 text-xs" key={match.id}>
                <span className="font-medium">{pairName(snapshot, match.pairAId)} vs {pairName(snapshot, match.pairBId)}</span>
                <span className="shrink-0 text-muted-foreground">#{match.playingOrder}{match.court ? ` · Court ${match.court}` : ''}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  )
}
