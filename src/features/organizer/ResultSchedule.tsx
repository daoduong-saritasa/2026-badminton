import { useMemo } from 'react'

import type { Match, TournamentSnapshot, UUID } from '@/domain/types'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/i18n/format'
import { messages } from '@/i18n/vi'
import { matchRoundLabel, pairName } from '@/features/tournament/MatchTicket'

export interface ResultScheduleProps {
  snapshot: TournamentSnapshot
  selectedMatchId: UUID | null
  onSelect: (matchId: UUID) => void
}

function scoreText(match: Match): string {
  if (match.resultKind === 'walkover') return messages.matchState.walkover
  if (!match.score) return ''
  return `${formatNumber(match.score.a)}–${formatNumber(match.score.b)}`
}

function MatchRow({
  snapshot,
  match,
  selected,
  actionLabel,
  onSelect,
}: {
  snapshot: TournamentSnapshot
  match: Match
  selected: boolean
  actionLabel: string
  onSelect: (matchId: UUID) => void
}) {
  return (
    <li
      className={
        selected
          ? 'flex flex-wrap items-center justify-between gap-2 rounded-md border border-ink/20 bg-ink/[0.03] px-3 py-2'
          : 'flex flex-wrap items-center justify-between gap-2 rounded-md border border-ink/5 px-3 py-2'
      }
    >
      <span className="min-w-0">
        <span className="block truncate text-[0.8125rem] font-medium">
          {messages.common.versus(pairName(snapshot, match.pairAId), pairName(snapshot, match.pairBId))}
        </span>
        <span className="block truncate text-[0.6875rem] text-muted-ink">
          {matchRoundLabel(match)}
          {match.court === null ? '' : ` · ${messages.common.court(match.court)}`}
          {scoreText(match) === '' ? '' : ` · ${scoreText(match)}`}
        </span>
      </span>
      <Button variant="outline" size="sm" onClick={() => onSelect(match.id)}>
        {actionLabel}
      </Button>
    </li>
  )
}

/**
 * Staff pick the match from the schedule they already read on the tournament
 * page, rather than from a flat list that gives no ordering or court context.
 * Completed matches stay reachable so a result can be corrected.
 */
export function ResultSchedule({ snapshot, selectedMatchId, onSelect }: ResultScheduleProps) {
  const { upcoming, completed } = useMemo(() => {
    const known = snapshot.matches.filter(
      (match) => match.pairAId !== null && match.pairBId !== null,
    )
    const byOrder = (a: Match, b: Match) => a.playingOrder - b.playingOrder
    return {
      upcoming: known.filter((match) => match.state === 'unstarted').sort(byOrder),
      completed: known.filter((match) => match.state === 'completed').sort(byOrder),
    }
  }, [snapshot])

  return (
    <section className="rounded-card border border-ink/5 bg-white p-6 shadow-card">
      <h3 className="text-sm font-semibold">{messages.results.heading}</h3>
      <p className="mt-1.5 text-[0.6875rem] text-muted-ink">
        {messages.results.description}
      </p>

      <h4 className="mt-5 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-ink">{messages.results.upcoming}</h4>
      {upcoming.length === 0 ? (
        <p className="mt-2 text-[0.8125rem] text-muted-ink">{messages.results.noUpcoming}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {upcoming.map((match) => (
            <MatchRow
              key={match.id}
              snapshot={snapshot}
              match={match}
              selected={match.id === selectedMatchId}
              actionLabel={messages.results.enterResult}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}

      <h4 className="mt-6 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-ink">{messages.results.completed}</h4>
      {completed.length === 0 ? (
        <p className="mt-2 text-[0.8125rem] text-muted-ink">{messages.results.noCompleted}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {completed.map((match) => (
            <MatchRow
              key={match.id}
              snapshot={snapshot}
              match={match}
              selected={match.id === selectedMatchId}
              actionLabel={messages.results.correct}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
