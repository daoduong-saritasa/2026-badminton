import type { FixtureMatch, Side, TournamentSnapshot } from '@/domain/types'
import { matchGameTally } from '@/domain/scoring'
import { Badge } from '@/components/ui/badge'
import { formatNumber } from '@/i18n/format'
import { messages } from '@/i18n/vi'
import { cn } from '@/lib/utils'

import {
  fixtureLabel,
  fixtureOf,
  matchPair,
  openGame,
  pairPlayers,
  scoreText,
  sideTeamId,
  teamName,
} from './labels'

function TicketSide({
  match,
  side,
  snapshot,
}: {
  match: FixtureMatch
  side: Side
  snapshot: TournamentSnapshot
}) {
  const fixture = fixtureOf(snapshot, match)
  const live = openGame(match)
  const tally = matchGameTally(match.games)
  // A live game shows its points; anything else shows the games won.
  const value = match.state === 'playing' && live ? live.score[side] : tally[side]
  return (
    <div className="flex min-w-0 flex-col items-center text-center">
      <p className="max-w-full [overflow-wrap:anywhere] text-[0.9375rem] font-medium tracking-[-0.027em]">
        {teamName(snapshot, sideTeamId(fixture, side))}
      </p>
      <p className="mt-1 max-w-full [overflow-wrap:anywhere] text-[0.6875rem] text-muted-ink">
        {pairPlayers(snapshot, matchPair(snapshot, match, side))}
      </p>
      <strong
        className={cn(
          'numeric mt-4 block w-full min-w-0 rounded-[14px] text-[clamp(3rem,18vw,4.375rem)]/[1.35] font-bold tracking-[-0.057em] shadow-[inset_0_1px_0_rgb(255_255_255/0.53)]',
          side === 'a' ? 'bg-peach' : 'bg-ice',
        )}
      >
        {match.state === 'unstarted' ? '–' : formatNumber(value)}
      </strong>
    </div>
  )
}

export function MatchTicket({
  match,
  snapshot,
  nextLabel,
}: {
  match: FixtureMatch
  snapshot: TournamentSnapshot
  nextLabel?: string
}) {
  const fixture = fixtureOf(snapshot, match)
  const live = openGame(match)
  const status = match.state === 'playing'
    ? messages.ticket.status.playing
    : match.state === 'completed' ? messages.ticket.status.completed : messages.ticket.status.upNext
  return (
    <article
      className={cn(
        'ticket lift-card rounded-card border-t-[5px] bg-white p-[1.625rem] shadow-card',
        match.court === 2 ? 'border-t-cyan' : 'border-t-orange',
      )}
      aria-label={match.court ? messages.common.court(match.court) : messages.common.fixtureMatch(fixtureLabel(fixture), match.matchNumber)}
    >
      <div className="mb-7 flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <h3 className="text-sm font-semibold">
            {match.court ? messages.common.court(match.court) : messages.publicView.courtPending}
          </h3>
          <span
            className={cn(
              'shrink-0 rounded-pill px-2.5 py-1 text-[0.625rem] font-semibold',
              'bg-well text-muted-ink',
            )}
          >
            {fixtureLabel(fixture)}
          </span>
        </div>
        <Badge variant="status" className={match.state === 'playing' ? 'text-navy' : 'text-muted-ink'}>
          {status}
        </Badge>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_0.75rem_minmax(0,1fr)] items-center gap-1.5 sm:gap-3">
        <TicketSide match={match} side="a" snapshot={snapshot} />
        <span className="mt-[1.875rem] text-center text-xl opacity-40" aria-hidden="true">:</span>
        <TicketSide match={match} side="b" snapshot={snapshot} />
      </div>
      <div className="tear -mx-[1.625rem] -mb-[1.625rem] mt-[1.9375rem] px-[1.625rem] pt-5 pb-[1.1875rem]">
        <small className="text-[0.625rem] text-muted-ink">{messages.common.matchNumber(match.matchNumber)}</small>
        <p className="mt-[7px] text-xs/[1.6]">
          {match.state === 'playing' && live ? (
            <span className="font-medium">
              {messages.ticket.gameTally(live.gameNumber, scoreText(matchGameTally(match.games)))}
            </span>
          ) : null}
          {nextLabel ? (
            <span className="text-muted-ink">
              {match.state === 'playing' && live ? ' · ' : ''}{messages.ticket.upNext}: {nextLabel}
            </span>
          ) : null}
        </p>
      </div>
    </article>
  )
}
