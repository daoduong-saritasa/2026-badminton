import { useMemo } from 'react'

import type { FixtureMatch, TournamentSnapshot, UUID } from '@/domain/types'
import { Button } from '@/components/ui/button'
import {
  fixtureOf,
  isDeciderEligible,
  matchLabel,
  matchResultText,
  sideTeamId,
  teamName,
} from '@/features/tournament/labels'
import { messages } from '@/i18n/vi'

export type ResultAction = 'result' | 'substitute'

export interface ResultScheduleProps {
  snapshot: TournamentSnapshot
  onSelect: (matchId: UUID, action: ResultAction) => void
}

function MatchRow({
  snapshot,
  match,
  actionLabel,
  onSelect,
}: {
  snapshot: TournamentSnapshot
  match: FixtureMatch
  actionLabel: string
  onSelect: (matchId: UUID, action: ResultAction) => void
}) {
  // Players can change until the match starts; the match needs its pairs first.
  const substitutable = match.state === 'unstarted' && match.pairA !== null
  const fixture = fixtureOf(snapshot, match)
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ink/5 px-3 py-2">
      <span className="min-w-0">
        <span className="block truncate text-[0.8125rem] font-medium">
          {messages.common.versus(teamName(snapshot, sideTeamId(fixture, 'a')), teamName(snapshot, sideTeamId(fixture, 'b')))}
        </span>
        <span className="block truncate text-[0.6875rem] text-muted-ink">
          {matchLabel(snapshot, match)}
          {match.court === null ? '' : ` · ${messages.common.court(match.court)}`}
          {` · ${matchResultText(snapshot, match)}`}
        </span>
      </span>
      <span className="flex gap-2">
        {substitutable ? (
          <Button variant="outline" size="sm" onClick={() => onSelect(match.id, 'substitute')}>
            {messages.results.substitute}
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => onSelect(match.id, 'result')}>
          {actionLabel}
        </Button>
      </span>
    </li>
  )
}

/**
 * An open match can only be awarded as a walkover or, before it starts, have
 * its players substituted; live scores belong to the referee. A completed match
 * stays reachable so its result can be corrected.
 */
export function ResultSchedule({ snapshot, onSelect }: ResultScheduleProps) {
  const { open, completed } = useMemo(() => ({
    open: snapshot.matches.filter((match) =>
      (match.state === 'unstarted' || match.state === 'playing')
      && isDeciderEligible(snapshot, match)),
    completed: snapshot.matches.filter((match) => match.state === 'completed'),
  }), [snapshot])

  return (
    <section className="rounded-card border border-ink/5 bg-white p-6 shadow-card">
      <h3 className="text-sm font-semibold">{messages.results.heading}</h3>
      <p className="mt-1.5 text-[0.6875rem] text-muted-ink">
        {messages.results.description}
      </p>

      <h4 className="mt-5 text-[0.6875rem] font-semibold text-muted-ink">{messages.results.open}</h4>
      {open.length === 0 ? (
        <p className="mt-2 text-[0.8125rem] text-muted-ink">{messages.results.noOpen}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {open.map((match) => (
            <MatchRow key={match.id} snapshot={snapshot} match={match} actionLabel={messages.results.walkover} onSelect={onSelect} />
          ))}
        </ul>
      )}

      <h4 className="mt-6 text-[0.6875rem] font-semibold text-muted-ink">{messages.results.completed}</h4>
      {completed.length === 0 ? (
        <p className="mt-2 text-[0.8125rem] text-muted-ink">{messages.results.noCompleted}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {completed.map((match) => (
            <MatchRow key={match.id} snapshot={snapshot} match={match} actionLabel={messages.results.correct} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </section>
  )
}
