import type { FixtureMatch, Side, TournamentSnapshot } from '@/domain/types'
import { gamesToWinMatch, matchGameTally } from '@/domain/scoring'
import { Badge } from '@/components/ui/badge'
import { formatNumber } from '@/i18n/format'
import { messages } from '@/i18n/messages'
import { cn } from '@/lib/utils'
import { PairDisplay, TeamIdentity } from './Participants'

import {
  courtLabel,
  fixtureScheduleLabel,
  fixtureOf,
  matchPair,
  openGame,
  scoreText,
  sideTeamId,
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
  const singleGame = fixture !== undefined && gamesToWinMatch(fixture.stage) === 1
  const lastGame = match.games.findLast((game) => game.confirmedAt !== null)
  // A live game shows its points; a one-game match shows its game's points;
  // a best-of-three shows the games won.
  const value = match.state === 'playing' && live
    ? live.score[side]
    : singleGame && lastGame ? lastGame.score[side] : tally[side]
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4">
      <TeamIdentity snapshot={snapshot} teamId={sideTeamId(fixture, side)} className="text-base" />
      <PairDisplay snapshot={snapshot} pair={matchPair(match, side)} compact className="col-start-1 row-start-2 mt-1" />
      <strong
        className={cn(
          'numeric col-start-2 row-span-2 row-start-1 min-w-[3.5rem] text-right text-4xl font-bold leading-none tracking-[-0.06em]',
          match.state === 'playing' ? 'text-navy' : 'text-muted-ink',
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
}: {
  match: FixtureMatch
  snapshot: TournamentSnapshot
}) {
  const fixture = fixtureOf(snapshot, match)
  const live = openGame(match)
  const status = match.state === 'playing'
    ? messages.ticket.status.playing
    : match.state === 'completed' ? messages.ticket.status.completed : messages.ticket.status.upNext
  return (
    <article
      className={cn(
        'ticket rounded-card border border-line bg-white p-5 shadow-card',
      )}
      aria-label={match.court ? courtLabel(snapshot, match.court) : messages.common.fixtureMatch(fixtureScheduleLabel(snapshot, fixture), match.matchNumber)}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <h3 className="text-base font-semibold [overflow-wrap:anywhere]">
            {match.court ? courtLabel(snapshot, match.court) : messages.publicView.courtPending}
          </h3>
          <span
            className={cn(
              'text-xs font-medium text-muted-ink',
            )}
          >
            {fixtureScheduleLabel(snapshot, fixture)} · {messages.common.matchNumber(match.matchNumber)}
          </span>
        </div>
        <Badge variant="status" className={match.state === 'playing' ? 'text-navy' : 'text-muted-ink'}>
          {status}
        </Badge>
      </div>
      <div className="grid gap-4">
        <TicketSide match={match} side="a" snapshot={snapshot} />
        <TicketSide match={match} side="b" snapshot={snapshot} />
      </div>
      {match.state === 'playing' && live && fixture !== undefined && gamesToWinMatch(fixture.stage) === 2 ? (
        <div className="-mx-5 -mb-5 mt-4 rounded-b-card border-t border-hairline bg-well px-5 py-3">
          <p className="text-xs/[1.6] font-medium">
            {messages.ticket.gameTally(live.gameNumber, scoreText(matchGameTally(match.games)))}
          </p>
        </div>
      ) : null}
    </article>
  )
}
