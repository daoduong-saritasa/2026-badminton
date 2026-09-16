import { useMemo } from 'react'

import type { Match, TournamentSnapshot, UUID } from '@/domain/types'
import { Button } from '@/components/ui/button'
import { matchRoundLabel, pairName } from '@/features/tournament/MatchTicket'

export interface ResultScheduleProps {
  snapshot: TournamentSnapshot
  selectedMatchId: UUID | null
  onSelect: (matchId: UUID) => void
}

function scoreText(match: Match): string {
  if (match.resultKind === 'walkover') return 'Walkover'
  if (!match.score) return ''
  return `${match.score.a}–${match.score.b}`
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
          {pairName(snapshot, match.pairAId)} vs {pairName(snapshot, match.pairBId)}
        </span>
        <span className="block truncate text-[0.6875rem] text-muted-ink">
          {matchRoundLabel(match)}
          {match.court === null ? '' : ` · Court ${match.court}`}
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
      <h3 className="text-sm font-semibold">Results</h3>
      <p className="mt-1.5 text-[0.6875rem] text-muted-ink">
        Record a result for a match played without live scoring, or correct one that was already recorded.
      </p>

      <h4 className="mt-5 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-ink">Upcoming</h4>
      {upcoming.length === 0 ? (
        <p className="mt-2 text-[0.8125rem] text-muted-ink">No unstarted match has both participants yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {upcoming.map((match) => (
            <MatchRow
              key={match.id}
              snapshot={snapshot}
              match={match}
              selected={match.id === selectedMatchId}
              actionLabel="Enter result"
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}

      <h4 className="mt-6 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-ink">Completed</h4>
      {completed.length === 0 ? (
        <p className="mt-2 text-[0.8125rem] text-muted-ink">No result has been recorded yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {completed.map((match) => (
            <MatchRow
              key={match.id}
              snapshot={snapshot}
              match={match}
              selected={match.id === selectedMatchId}
              actionLabel="Correct"
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
