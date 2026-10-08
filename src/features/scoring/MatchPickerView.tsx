import type { ReactNode } from 'react'
import { ArrowLeft, Play, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { gamesToWinMatch, matchGameTally } from '@/domain/scoring'
import type { FixtureMatch, TournamentSnapshot, UUID } from '@/domain/types'
import { PairLines } from '@/features/tournament/PairLines'
import { SeedLegend } from '@/features/tournament/Participants'
import { courtLabel, fixtureLabel, fixtureOf, groupByFixture, matchLabel, openGame, scoreText, sideTeamId, startBlocker, teamName, upcomingMatches } from '@/features/tournament/labels'
import { messages } from '@/i18n/messages'

export function MatchPickerView({ snapshot, onSelect, onExit, onAssign, onStart, startPending = false, courtControl }: {
  snapshot: TournamentSnapshot; onSelect: (matchId: UUID) => void; onExit: () => void;
  onAssign: (fixtureId: UUID) => void; onStart: (matchId: UUID) => void; startPending?: boolean;
  /** Control that changes an upcoming match's court; without it the court is shown as text. */
  courtControl?: (match: FixtureMatch) => ReactNode;
}) {
  const playing = snapshot.matches.filter((match) => match.state === 'playing')
  const upcoming = upcomingMatches(snapshot)
  const row = (match: FixtureMatch, action: ReactNode) => (
    <li className="grid gap-3 border-t border-hairline py-4 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={match.id}>
      <div className="min-w-0">
        <span className="block text-[0.9375rem] font-semibold [overflow-wrap:anywhere]">
          {messages.common.versus(teamName(snapshot, sideTeamId(fixtureOf(snapshot, match), 'a')), teamName(snapshot, sideTeamId(fixtureOf(snapshot, match), 'b')))}
        </span>
        <span className="mt-1 block text-[0.8125rem] text-muted-ink">
          {match.court ? courtLabel(snapshot, match.court) : messages.publicView.courtPending} · {matchLabel(snapshot, match)}
        </span>
        <PairLines snapshot={snapshot} match={match} className="mt-1" />
        {match.state === 'playing' ? (
          <span className="mt-1 block text-[0.8125rem] text-muted-ink">
            {gamesToWinMatch(fixtureOf(snapshot, match)?.stage ?? 'qualifying') === 2
              ? `${messages.scoring.gameStatus((openGame(match) ?? { gameNumber: 1, score: { a: 0, b: 0 } }).gameNumber, scoreText(matchGameTally(match.games)))} · `
              : ''}
            {scoreText((openGame(match) ?? { gameNumber: 1, score: { a: 0, b: 0 } }).score)}
          </span>
        ) : null}
      </div>
      {action}
    </li>
  )

  return (
    <div className="space-y-6" data-guide="matches">
      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" size="sm" onClick={onExit}>
          <ArrowLeft /> {messages.scoring.back}
        </Button>
        <h2 className="text-lg font-semibold tracking-[-0.033em]">{messages.scoring.pickHeading}</h2>
      </div>
      <SeedLegend />
      {playing.length > 0 ? (
        <section className="rounded-card border border-ink/5 bg-white px-5 py-2 shadow-card">
          <h3 className="pt-3 text-sm font-semibold">{messages.scoring.resumeHeading}</h3>
          <ul>{playing.map((match) => row(match, <Button onClick={() => onSelect(match.id)}>{messages.scoring.resume}</Button>))}</ul>
        </section>
      ) : null}
      <section className="rounded-card border border-ink/5 bg-white px-5 py-2 shadow-card">
        <h3 className="pt-3 text-sm font-semibold">{messages.scoring.startHeading}</h3>
        {upcoming.length === 0 ? (
          <p className="py-4 text-sm text-muted-ink">{messages.scoring.noMatch}</p>
        ) : (
          <ul className="divide-y divide-line">
            {groupByFixture(upcoming).map(({ fixtureId, matches }) => {
              const fixture = snapshot.fixtures.find((candidate) => candidate.id === fixtureId)
              const fixtureTeams = messages.common.versus(teamName(snapshot, sideTeamId(fixture, 'a')), teamName(snapshot, sideTeamId(fixture, 'b')))
              const paired = matches.every((match) => match.pairA !== null && match.pairB !== null)
              return (
                <li className="py-6" aria-label={`${fixtureLabel(fixture)} · ${fixtureTeams}`} key={fixtureId}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[0.9375rem] font-semibold [overflow-wrap:anywhere]">{fixtureTeams}</p>
                      <p className="mt-0.5 text-[0.8125rem] text-muted-ink">{fixtureLabel(fixture)}</p>
                    </div>
                    <Button className={paired ? 'w-[7.5rem] border-navy text-navy hover:bg-navy-soft' : 'w-[7.5rem] bg-navy text-white hover:bg-ink'} variant={paired ? 'outline' : 'secondary'} onClick={() => { onAssign(fixtureId) }}>
                      <Users /> {messages.pairAssignment.open}
                    </Button>
                  </div>
                  <ul className="mt-4 divide-y divide-hairline">
                    {matches.map((match) => (
                      <li className="grid grid-cols-[minmax(0,1fr)_7.5rem] items-center gap-x-4 gap-y-4 py-5 first:pt-0 last:pb-0" aria-label={messages.common.matchNumber(match.matchNumber)} key={match.id}>
                        <p className="w-fit rounded-field bg-well px-2.5 py-1 text-sm font-semibold">
                          {messages.common.matchNumber(match.matchNumber)}
                          {courtControl ? null : <span className="font-normal text-muted-ink"> · {match.court ? courtLabel(snapshot, match.court) : messages.publicView.courtPending}</span>}
                        </p>
                        <p data-guide={match.matchNumber === 1 ? 'blocked' : undefined} className="text-right text-xs text-muted-ink">
                          {startBlocker(snapshot, match) ? messages.scoring.startBlocked[startBlocker(snapshot, match) ?? 'pairs'] : null}
                        </p>
                        <PairLines snapshot={snapshot} match={match} className="col-span-2 sm:col-span-1" />
                        {courtControl ? <div className="col-start-1" data-guide={match.matchNumber === 1 ? 'court' : undefined}>{courtControl(match)}</div> : null}
                        <Button className="col-start-2 w-full self-start" disabled={startBlocker(snapshot, match) !== null || startPending} onClick={() => onStart(match.id)}>
                          <Play /> {messages.scoring.start}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
