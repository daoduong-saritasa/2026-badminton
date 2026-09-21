import { fixtureWinnerTeamId } from '@/domain/team-fixtures'
import type { Side, TeamFixture, TournamentSnapshot } from '@/domain/types'
import { formatNumber } from '@/i18n/format'
import { messages } from '@/i18n/vi'
import { cn } from '@/lib/utils'

import {
  fixtureLabel,
  fixtureMatches,
  fixtureScore,
  matchPair,
  matchResultText,
  pairPlayers,
  sideTeamId,
  teamName,
} from './labels'

/**
 * One team fixture: the two teams, the match tally, and each match's pairs and
 * games. `placeholders` names a side whose team is not decided yet, and
 * `label` names a fixture that does not exist yet.
 */
export function FixtureCard({
  snapshot,
  fixture,
  label,
  placeholders,
  final = false,
}: {
  snapshot: TournamentSnapshot
  fixture: TeamFixture | undefined
  label?: string
  placeholders?: Record<Side, string>
  final?: boolean
}) {
  const matches = fixture ? fixtureMatches(snapshot, fixture.id) : []
  const tally = fixture ? fixtureScore(snapshot, fixture.id) : { a: 0, b: 0 }
  const winnerId = fixture ? fixtureWinnerTeamId(fixture, matches) : null
  const sides: Side[] = ['a', 'b']

  return (
    <article
      className={cn(
        'ticket rounded-card p-6',
        final ? 'bg-navy text-white shadow-final' : 'border border-line bg-white',
      )}
    >
      <h3 className="mb-4 flex items-center gap-2.5 text-[0.9375rem] font-semibold">
        {label ?? fixtureLabel(fixture)}
      </h3>
      <div className="space-y-2">
        {sides.map((side) => {
          const teamId = sideTeamId(fixture, side)
          const won = teamId !== null && teamId === winnerId
          return (
            <div
              className={cn(
                'grid grid-cols-[minmax(0,1fr)_2.125rem] items-center gap-2.5 rounded-chip px-3 py-2 text-[0.8125rem] font-medium',
                won && (final ? 'bg-white/10' : 'bg-navy/5'),
              )}
              key={side}
            >
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {teamId === null ? placeholders?.[side] ?? messages.common.toBeDecided : teamName(snapshot, teamId)}
                {won ? <span className={cn('ml-2 text-[0.625rem] font-semibold', final ? 'text-cyan' : 'text-navy')}>{messages.fixtures.winner}</span> : null}
              </span>
              <strong className={cn('numeric grid h-9 place-items-center rounded-chip text-[1.375rem] font-normal', final ? 'bg-white/[0.07] text-navy-soft' : 'bg-well text-dim-ink')}>
                {matches.length === 0 ? '–' : formatNumber(tally[side])}
              </strong>
            </div>
          )
        })}
      </div>
      {matches.length > 0 ? (
        <ol className={cn('mt-4 border-t pt-2', final ? 'border-white/25' : 'border-hairline')}>
          {matches.map((match) => (
            <li className="grid gap-0.5 py-2 text-[0.6875rem]" key={match.id}>
              <span className="flex flex-wrap justify-between gap-2">
                <span className="font-semibold">{messages.common.matchNumber(match.matchNumber)}</span>
                <span className={final ? 'text-navy-soft' : 'text-muted-ink'}>{matchResultText(snapshot, match)}</span>
              </span>
              <span className={cn('[overflow-wrap:anywhere]', final ? 'text-white/65' : 'text-muted-ink')}>
                {messages.common.versus(pairPlayers(snapshot, matchPair(snapshot, match, 'a')), pairPlayers(snapshot, matchPair(snapshot, match, 'b')))}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className={cn('mt-4 text-[0.6875rem]', final ? 'text-navy-soft' : 'text-muted-ink')}>{messages.fixtures.matchesPending}</p>
      )}
    </article>
  )
}
