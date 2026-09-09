import { Trophy } from 'lucide-react'

import type { Match, TournamentSnapshot } from '@/domain/types'
import { cn } from '@/lib/utils'

import { pairName, pairPlayers, pairSeeds, pairTeamName } from './MatchTicket'

/** "SF1 winner" -> "SF1"; the chip is 30px square and the phrase is in the row. */
function seedChipLabel(label: string | null, fallback: string): string {
  return label?.replace(/\s*winner$/i, '') ?? fallback
}

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
    <article
      className={cn(
        'ticket lift-card mb-[1.125rem] rounded-card',
        final
          ? 'bg-navy text-white shadow-final'
          : 'border border-ink/4 bg-white shadow-ticket',
      )}
    >
      <div className={cn('flex items-center justify-between gap-3 px-[1.375rem] pt-[1.1875rem] pb-[0.8125rem]', final && 'pt-6')}>
        <h3 className={cn('flex items-center gap-2 text-xs font-semibold', final && 'text-lg tracking-[-0.028em]')}>
          <span className={cn('block shrink-0 rounded-[2px] bg-orange', final ? 'size-2' : 'size-1.5')} aria-hidden="true" />
          {label}
        </h3>
        <span className={cn('text-[0.625rem]', final ? 'text-navy-soft' : 'text-muted-ink')}>
          {match.court ? `Court ${match.court}` : 'Court pending'}
        </span>
      </div>
      <div className={cn('px-5 pb-[1.0625rem]', final && 'pt-2.5 pb-6')}>
        {sides.map((side, index) => (
          <div className={cn('grid grid-cols-[1.875rem_minmax(0,1fr)_2.125rem] items-center gap-2.5 py-2.5 text-xs font-medium', final && 'py-3')} key={`${match.id}-${index}`}>
            <span className={cn('grid size-[1.875rem] place-items-center overflow-hidden rounded-chip text-[0.5625rem] font-bold',
              final ? 'bg-white/10 text-white' : 'bg-mist text-navy')}>
              {index === 0 ? seedChipLabel(match.sourceALabel, 'A') : seedChipLabel(match.sourceBLabel, 'B')}
            </span>
            <div className="min-w-0">
              <p className="truncate">{side.pairId ? pairName(snapshot, side.pairId) : side.fallback}</p>
              <p className={cn('mt-[3px] truncate text-[0.625rem] font-normal', final ? 'text-white/65' : 'text-muted-ink')}>
                {side.pairId
                  ? `${pairTeamName(snapshot, side.pairId) ? `${pairPlayers(snapshot, side.pairId)} · ` : ''}${pairSeeds(snapshot, side.pairId)}`
                  : 'Awaiting qualifier'}
              </p>
            </div>
            <strong className={cn('numeric grid h-9 w-[2.125rem] place-items-center rounded-chip text-[1.375rem] font-normal',
              final ? 'bg-white/[0.07] text-navy-soft' : 'bg-well text-dim-ink')}>
              {side.score ?? '–'}
            </strong>
          </div>
        ))}
      </div>
      <div className={cn('tear tear-sm flex items-center justify-between px-[1.375rem] py-[0.8125rem] text-[0.625rem]',
        final ? 'border-white/25 text-navy-soft' : 'border-line text-muted-ink')}>
        <span>{final ? 'Championship match' : 'Winner advances to final'}</span>
        <span className={cn(final ? 'text-[1.375rem] font-bold tracking-[-1px] text-cyan' : 'text-[0.9375rem] text-navy')} aria-hidden="true">
          {final ? '01' : '↗'}
        </span>
      </div>
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
      <section className="view-enter rounded-[2rem] bg-navy px-7 py-12 text-center text-white shadow-final">
        <Trophy className="mx-auto size-9 text-cyan" aria-hidden="true" />
        <p className="mt-5 text-xs uppercase tracking-[0.25em] text-navy-soft">Tournament champion</p>
        <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-5xl">{champion}</h2>
        {championId ? (
          <p className="mt-3 text-sm text-navy-soft">
            {pairTeamName(snapshot, championId) ? `${pairPlayers(snapshot, championId)} · ` : ''}{pairSeeds(snapshot, championId)}
          </p>
        ) : null}
      </section>
    )
  }

  return (
    <section className="view-enter">
      <div className="mb-7 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.033em]">The knockout stage</h2>
          <p className="mt-2 text-xs text-muted-ink">Semifinal winners advance to the championship match.</p>
        </div>
        <span className="text-[0.625rem] text-muted-ink">
          {snapshot.tournament.stage === 'groups' ? 'Awaiting confirmed group standings' : 'Bracket active'}
        </span>
      </div>
      <div className="grid items-center gap-13 md:grid-cols-2">
        <div>
          <h3 className="mb-4 flex items-center gap-2.5 text-xs font-semibold">
            Semifinals <span className="font-normal text-muted-ink">{semifinals.length} matches</span>
          </h3>
          {semifinals.map((match, index) => (
            <BracketMatch key={match.id} match={match} snapshot={snapshot} label={`Semifinal ${index + 1}`} />
          ))}
        </div>
        {final ? (
          <div className="relative before:absolute before:-left-[2.125rem] before:top-[calc(50%-4.25rem)] before:hidden before:h-34 before:w-[1.0625rem] before:rounded-r-chip before:border before:border-l-0 before:border-rule before:content-[''] after:absolute after:-left-[1.0625rem] after:top-1/2 after:hidden after:w-[1.0625rem] after:border-t after:border-rule after:content-[''] md:before:block md:after:block">
            <h3 className="mb-4 flex items-center gap-2.5 text-xs font-semibold">
              Final <span className="font-normal text-muted-ink">2 pairs</span>
            </h3>
            <BracketMatch match={final} snapshot={snapshot} label="The final" final />
          </div>
        ) : null}
      </div>
    </section>
  )
}
