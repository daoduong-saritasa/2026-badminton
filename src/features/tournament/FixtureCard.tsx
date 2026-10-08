import { fixtureWinnerTeamId } from '@/domain/team-fixtures'
import type { Side, TeamFixture, TournamentSnapshot } from '@/domain/types'
import { formatNumber } from '@/i18n/format'
import { messages } from '@/i18n/messages'
import { cn } from '@/lib/utils'
import { PairLines } from './PairLines'
import { TeamIdentity } from './Participants'

import {
  fixtureScheduleLabel,
  fixtureMatches,
  fixtureScore,
  isDrawnFixture,
  matchResultText,
  sideTeamId,
  stageRule,
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
  const drawn = fixture ? isDrawnFixture(snapshot, fixture) : false
  const stage = fixture?.stage ?? (final ? 'final' : undefined)
  const sides: Side[] = ['a', 'b']

  return (
    <article
      className={cn(
        'ticket rounded-card p-4 sm:p-5',
        final ? 'border border-navy-soft bg-mist shadow-final' : 'border border-line bg-white',
      )}
    >
      <h3 className="flex flex-wrap items-center gap-2.5 text-[0.9375rem] font-semibold">
        {label ?? fixtureScheduleLabel(snapshot, fixture)}
        {matches.some((match) => match.state === 'playing') ? <span className="text-xs font-semibold text-navy">{messages.matchState.playing}</span> : null}
        {drawn ? <span className="rounded-pill bg-well px-2 py-0.5 text-xs font-semibold text-muted-ink">{messages.fixtures.drawn}</span> : null}
      </h3>
      {stage && stage !== 'qualifying' ? (
        <p className="mt-1 mb-4 text-xs text-muted-ink">{stageRule(stage)}</p>
      ) : <div className="mb-4" />}
      <div className="space-y-2">
        {sides.map((side) => {
          const teamId = sideTeamId(fixture, side)
          const won = teamId !== null && teamId === winnerId
          return (
            <div
              className={cn(
                'grid grid-cols-[minmax(0,1fr)_2.125rem] items-center gap-2.5 rounded-chip px-3 py-2 text-[0.8125rem] font-medium',
                won ? 'bg-peach' : 'bg-white/70',
              )}
              key={side}
            >
              <div className="min-w-0">
                {teamId === null ? (
                  <span className="text-muted-ink">{placeholders?.[side] ?? messages.common.toBeDecided}</span>
                ) : <TeamIdentity snapshot={snapshot} teamId={teamId} className="text-sm" />}
                {won ? <span className="mt-2 block text-xs font-semibold text-navy">{messages.fixtures.winner}</span> : null}
              </div>
              <strong className="numeric grid h-9 place-items-center rounded-chip bg-white text-2xl font-bold text-navy">
                {matches.length === 0 ? '–' : formatNumber(tally[side])}
              </strong>
            </div>
          )
        })}
      </div>
      {matches.length > 0 ? (
        <ol className="mt-4 border-t border-hairline pt-2">
          {matches.map((match) => (
            <li className="grid gap-0.5 border-b border-hairline py-4 text-xs last:border-b-0" key={match.id}>
              <span className="flex flex-wrap justify-between gap-2">
                <span className="font-semibold">{messages.common.matchNumber(match.matchNumber)}</span>
                <span className="text-muted-ink">{matchResultText(snapshot, match)}</span>
              </span>
              <PairLines snapshot={snapshot} match={match} className="mt-3" />
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-xs text-muted-ink">{messages.fixtures.matchesPending}</p>
      )}
    </article>
  )
}
