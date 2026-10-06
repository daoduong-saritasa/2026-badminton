import { useMemo, useState } from 'react'

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

export interface ResultScheduleProps {
  snapshot: TournamentSnapshot
  onSelect: (matchId: UUID) => void
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
  onSelect: (matchId: UUID) => void
}) {
  const fixture = fixtureOf(snapshot, match)
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <span className="min-w-0">
        <span className="block text-sm font-semibold [overflow-wrap:anywhere]">
          {messages.common.versus(teamName(snapshot, sideTeamId(fixture, 'a')), teamName(snapshot, sideTeamId(fixture, 'b')))}
        </span>
        <span className="mt-1 block text-[0.8125rem] text-muted-ink">
          {matchLabel(snapshot, match)}
          {match.court === null ? '' : ` · ${messages.common.court(match.court)}`}
          {` · ${matchResultText(snapshot, match)}`}
        </span>
      </span>
      <Button variant="outline" size="sm" onClick={() => onSelect(match.id)}>
        {actionLabel}
      </Button>
    </li>
  )
}

/**
 * Completed matches, each open to correction. Open matches can only be
 * awarded as walkovers, which is rare, so that list stays folded away until
 * asked for.
 */
export function ResultSchedule({ snapshot, onSelect }: ResultScheduleProps) {
  const { open, completed } = useMemo(() => ({
    open: snapshot.matches.filter((match) =>
      (match.state === 'unstarted' || match.state === 'playing')
      && isDeciderEligible(snapshot, match)),
    completed: snapshot.matches.filter((match) => match.state === 'completed'),
  }), [snapshot])
  const [showOpen, setShowOpen] = useState(false)

  return (
    <section className="rounded-card border border-ink/5 bg-white p-5 shadow-card sm:p-6">
      <h3 className="text-[0.9375rem] font-semibold">{messages.results.completed}</h3>
      {completed.length === 0 ? (
        <p className="mt-3 text-[0.8125rem] text-muted-ink">{messages.results.noCompleted}</p>
      ) : (
        <ul className="mt-4 divide-y divide-hairline">
          {completed.map((match) => (
            <MatchRow key={match.id} snapshot={snapshot} match={match} actionLabel={messages.results.correct} onSelect={onSelect} />
          ))}
        </ul>
      )}

      <div className="mt-6 border-t border-hairline pt-4">
        <Button variant="ghost" className="-ml-3" aria-expanded={showOpen} onClick={() => setShowOpen((value) => !value)}>
          {showOpen ? messages.results.hideWalkovers : messages.results.showWalkovers(open.length)}
        </Button>
        {showOpen ? (
          open.length === 0 ? (
            <p className="mt-2 text-[0.8125rem] text-muted-ink">{messages.results.noOpen}</p>
          ) : (
            <ul className="mt-2 divide-y divide-hairline">
              {open.map((match) => (
                <MatchRow key={match.id} snapshot={snapshot} match={match} actionLabel={messages.results.walkover} onSelect={onSelect} />
              ))}
            </ul>
          )
        ) : null}
      </div>
    </section>
  )
}
