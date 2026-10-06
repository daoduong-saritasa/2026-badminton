import type { FixtureMatch, TournamentSnapshot } from '@/domain/types'
import { formatNumber } from '@/i18n/format'
import { messages } from '@/i18n/vi'

import { confirmedGames, courtLabel, fixtureOf, matchLabel, matchPair, matchResultText, sideTeamId } from './labels'
import { PairDisplay, TeamIdentity } from './Participants'

export function MatchSummary({ snapshot, match, compact = false }: {
  snapshot: TournamentSnapshot
  match: FixtureMatch
  compact?: boolean
}) {
  const fixture = fixtureOf(snapshot, match)
  const games = confirmedGames(match)
  const showPairs = !compact || match.pairA !== null || match.pairB !== null
  const hasScores = match.state === 'completed' && match.resultKind === 'played' && games.length > 0

  return (
    <article className="min-w-0 border-t border-line py-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-ink">
        <span className="min-w-0 [overflow-wrap:anywhere]">{matchLabel(snapshot, match)}</span>
        <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">{match.court ? courtLabel(snapshot, match.court) : messages.publicView.courtPending}</span>
      </header>
      {hasScores && games.length > 1 ? (
        <div className="mb-2 flex justify-end gap-3 text-xs text-muted-ink" aria-label={messages.results.gameScores}>
          {games.map((game) => <span className="w-9 whitespace-nowrap text-center" key={game.gameNumber}>{messages.common.gameNumber(game.gameNumber)}</span>)}
        </div>
      ) : null}
      <div className="space-y-4">
        {(['a', 'b'] as const).map((side) => {
          const won = match.state === 'completed' && match.winnerSide === side
          return (
            <div className="flex min-w-0 items-center gap-3" key={side}>
              <div className="min-w-0 flex-1">
                <TeamIdentity snapshot={snapshot} teamId={sideTeamId(fixture, side)} className="text-base" />
                {showPairs ? <PairDisplay snapshot={snapshot} pair={matchPair(match, side)} compact className="mt-1" /> : null}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {won ? <span className="shrink-0 text-xs font-semibold text-navy">{messages.fixtures.winner}</span> : null}
                {hasScores ? (
                  <div className="numeric flex shrink-0 gap-3">
                    {games.map((game) => (
                      <span className="w-9 whitespace-nowrap text-center" key={game.gameNumber}>
                        <span className="sr-only">{messages.common.gameNumber(game.gameNumber)}: </span>
                        <strong className="text-2xl font-semibold">{formatNumber(game.score[side])}</strong>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
      {compact && !showPairs ? <p className="mt-3 text-sm text-muted-ink">{messages.pairAssignment.notAssigned}</p> : null}
      {hasScores || (compact && match.state === 'unstarted') ? null : <p className="mt-3 text-sm font-medium text-muted-ink">{matchResultText(snapshot, match)}</p>}
    </article>
  )
}
