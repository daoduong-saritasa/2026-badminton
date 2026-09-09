import { Trophy } from 'lucide-react'

import type { Match, TournamentSnapshot } from '@/domain/types'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import { pairName, pairPlayers, pairSeeds, pairTeamName } from './MatchTicket'

function BracketMatch({
  match,
  snapshot,
  label,
  final = false,
}: {
  match: Match
  snapshot: TournamentSnapshot
  label: string
  final?: boolean
}) {
  const sides = [
    { pairId: match.pairAId, fallback: match.sourceALabel, score: match.score?.a },
    { pairId: match.pairBId, fallback: match.sourceBLabel, score: match.score?.b },
  ]
  return (
    <article className={cn('ticket rounded-[1.375rem] border p-5', final ? 'bg-primary text-primary-foreground' : 'bg-white')}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-semibold">{label}</h3>
        <span className={cn('text-[0.625rem]', final ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
          {match.court ? `Court ${match.court}` : 'Court pending'}
        </span>
      </div>
      {sides.map((side, index) => (
        <div className="grid grid-cols-[2.25rem_1fr_2.25rem] items-center gap-3 border-t border-current/10 py-3" key={`${match.id}-${index}`}>
          <Badge className={cn('justify-center rounded-lg', final && 'bg-white/10 text-white')} variant="secondary">
            {index === 0 ? match.sourceALabel ?? 'A' : match.sourceBLabel ?? 'B'}
          </Badge>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold">{side.pairId ? pairName(snapshot, side.pairId) : side.fallback}</p>
            {side.pairId ? (
              <p className={cn('mt-0.5 truncate text-[0.625rem]', final ? 'text-white/65' : 'text-muted-foreground')}>
                {pairTeamName(snapshot, side.pairId) ? `${pairPlayers(snapshot, side.pairId)} · ` : ''}{pairSeeds(snapshot, side.pairId)}
              </p>
            ) : null}
          </div>
          <strong className={cn('numeric rounded-lg p-2 text-center text-lg', final ? 'bg-white/10' : 'bg-muted')}>
            {side.score ?? '–'}
          </strong>
        </div>
      ))}
    </article>
  )
}

export function KnockoutBracket({ snapshot }: { snapshot: TournamentSnapshot }) {
  const semifinals = snapshot.matches.filter((match) => match.round === 'semifinal')
  const final = snapshot.matches.find((match) => match.round === 'final')
  const champion = final?.state === 'completed' && final.winnerId ? pairName(snapshot, final.winnerId) : null
  const championId = final?.state === 'completed' ? final.winnerId : null

  if (champion) {
    return (
      <section className="view-enter rounded-[2rem] bg-primary px-7 py-12 text-center text-primary-foreground shadow-xl">
        <Trophy className="mx-auto size-9 text-[#23c0c3]" aria-hidden="true" />
        <p className="mt-5 text-xs uppercase tracking-[0.25em] text-primary-foreground/70">Tournament champion</p>
        <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-5xl">{champion}</h2>
        {championId ? (
          <p className="mt-3 text-sm text-primary-foreground/70">
            {pairTeamName(snapshot, championId) ? `${pairPlayers(snapshot, championId)} · ` : ''}{pairSeeds(snapshot, championId)}
          </p>
        ) : null}
      </section>
    )
  }

  return (
    <section className="view-enter">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">The knockout stage</h2>
          <p className="mt-1 text-xs text-muted-foreground">Semifinal winners advance to the championship match.</p>
        </div>
        <span className="text-[0.625rem] text-muted-foreground">
          {snapshot.tournament.stage === 'groups' ? 'Awaiting confirmed group standings' : 'Bracket active'}
        </span>
      </div>
      <div className="grid items-center gap-8 md:grid-cols-2">
        <div className="space-y-4">
          {semifinals.map((match, index) => (
            <BracketMatch key={match.id} match={match} snapshot={snapshot} label={`Semifinal ${index + 1}`} />
          ))}
        </div>
        {final ? <BracketMatch match={final} snapshot={snapshot} label="The final" final /> : null}
      </div>
    </section>
  )
}
