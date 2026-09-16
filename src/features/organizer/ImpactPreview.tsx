import { calculateStandings } from '@/domain/standings'
import type { ImpactBlockCode, MutationImpact } from '@/domain/impacts'
import type { Group, Match, TournamentSnapshot, UUID } from '@/domain/types'
import { pairName } from '@/features/tournament/MatchTicket'

const groups: Group[] = ['A', 'B']

const blockExplanations: Record<ImpactBlockCode, string> = {
  // Every group result freezes once any knockout match leaves 'unstarted',
  // including a correction that keeps the same winner.
  'knockouts-started':
    'Knockout play has started, so no group result can be corrected — not even one that keeps the same winner. Record a walkover on the affected knockout match instead.',
  'final-started':
    'The final already depends on this semifinal, so its winner cannot change.',
  'too-few-active-pairs':
    'Each group must keep at least two active pairs. Record a walkover for the matches this pair cannot play instead of withdrawing them.',
  'invalid-match-state':
    'This match is not in a state that accepts this result. A match being scored live must be finished or reopened first.',
  'tournament-completed':
    'The tournament is completed. Reopen it before changing results.',
}

function scoreText(match: Match | undefined): string {
  if (!match) return '—'
  if (match.state === 'completed' && match.resultKind === 'walkover') return 'Walkover'
  if (!match.score) return 'Not played'
  return `${match.score.a}–${match.score.b}`
}

function matchById(snapshot: TournamentSnapshot | null, id: UUID): Match | undefined {
  return snapshot?.matches.find((match) => match.id === id)
}

function Row({ label, before, after }: { label: string; before: string; after: string }) {
  const changed = before !== after
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-2 py-1">
      <span className="min-w-0 truncate text-[0.6875rem] text-muted-ink">{label}</span>
      <span className={changed ? 'text-[0.8125rem] line-through opacity-60' : 'text-[0.8125rem]'}>{before}</span>
      <span className={changed ? 'text-[0.8125rem] font-semibold' : 'text-[0.8125rem] text-muted-ink'}>{after}</span>
    </div>
  )
}

/**
 * Renders the server's own projection. Nothing here recomputes what the
 * tournament would become — a second derivation could disagree with the change
 * the confirm button actually sends.
 */
export function ImpactPreview({ impact, matchId }: { impact: MutationImpact; matchId?: UUID }) {
  if (impact.blockedReason !== null) {
    return (
      <div className="space-y-2" role="alert">
        <p className="text-[0.8125rem] font-semibold text-destructive">This change is blocked</p>
        <p className="text-[0.8125rem] text-muted-ink">{blockExplanations[impact.blockedReason]}</p>
      </div>
    )
  }

  const { before, after } = impact
  if (after === null) return null

  const changedMatches = after.matches.filter((match) => {
    const previous = matchById(before, match.id)
    return !previous || previous.state !== match.state || scoreText(previous) !== scoreText(match)
  })

  const confirmationsLost = before.tieResolutions.filter(
    (resolution) => !after.tieResolutions.some((kept) => kept.group === resolution.group),
  )

  return (
    <div className="max-h-[50dvh] space-y-4 overflow-y-auto pr-1">
      {matchId ? (
        <section>
          <h4 className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-ink">Score</h4>
          <Row
            label={pairName(before, matchById(before, matchId)?.pairAId ?? null)}
            before={scoreText(matchById(before, matchId))}
            after={scoreText(matchById(after, matchId))}
          />
        </section>
      ) : null}

      {changedMatches.length > 0 ? (
        <section>
          <h4 className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-ink">
            Affected matches ({changedMatches.length})
          </h4>
          {changedMatches.map((match) => (
            <Row
              key={match.id}
              label={`${pairName(after, match.pairAId)} vs ${pairName(after, match.pairBId)}`}
              before={`${matchById(before, match.id)?.state ?? '—'} ${scoreText(matchById(before, match.id))}`}
              after={`${match.state} ${scoreText(match)}`}
            />
          ))}
        </section>
      ) : null}

      {groups.map((group) => {
        const beforeStandings = calculateStandings(before, group)
        const afterStandings = calculateStandings(after, group)
        if (afterStandings.length === 0) return null
        return (
          <section key={group}>
            <h4 className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-ink">Group {group}</h4>
            {afterStandings.map((standing) => (
              <Row
                key={standing.pairId}
                label={pairName(after, standing.pairId)}
                before={`#${beforeStandings.find((entry) => entry.pairId === standing.pairId)?.rank ?? '—'}`}
                after={`#${standing.rank ?? '—'}`}
              />
            ))}
          </section>
        )
      })}

      {confirmationsLost.length > 0 ? (
        <p className="text-[0.8125rem] text-destructive">
          {confirmationsLost.map((resolution) => `Group ${resolution.group}`).join(' and ')} must be confirmed again.
        </p>
      ) : null}
    </div>
  )
}
