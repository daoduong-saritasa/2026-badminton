import { calculateStandings } from '@/domain/standings'
import { formatNumber } from '@/i18n/format'
import { messages } from '@/i18n/vi'
import type { MutationImpact } from '@/domain/impacts'
import type { Group, Match, TournamentSnapshot, UUID } from '@/domain/types'
import { pairName } from '@/features/tournament/MatchTicket'

const groups: Group[] = ['A', 'B']

function scoreText(match: Match | undefined): string {
  if (!match) return '—'
  if (match.state === 'completed' && match.resultKind === 'walkover') return messages.matchState.walkover
  if (!match.score) return messages.matchState.notPlayed
  return `${formatNumber(match.score.a)}–${formatNumber(match.score.b)}`
}

function rankText(rank: number | null): string {
  return rank === null ? '—' : `#${formatNumber(rank)}`
}

function stateText(match: Match | undefined): string {
  return match ? messages.matchState[match.state] : '—'
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
        <p className="text-[0.8125rem] font-semibold text-destructive">{messages.impact.blockedHeading}</p>
        <p className="text-[0.8125rem] text-muted-ink">{messages.impact.blocked[impact.blockedReason]}</p>
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
          <h4 className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-ink">{messages.impact.score}</h4>
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
            {messages.impact.affectedMatches(changedMatches.length)}
          </h4>
          {changedMatches.map((match) => (
            <Row
              key={match.id}
              label={messages.common.versus(pairName(after, match.pairAId), pairName(after, match.pairBId))}
              before={`${stateText(matchById(before, match.id))} ${scoreText(matchById(before, match.id))}`}
              after={`${stateText(match)} ${scoreText(match)}`}
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
            <h4 className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-ink">{messages.common.group(group)}</h4>
            {afterStandings.map((standing) => (
              <Row
                key={standing.pairId}
                label={pairName(after, standing.pairId)}
                before={rankText(beforeStandings.find((entry) => entry.pairId === standing.pairId)?.rank ?? null)}
                after={rankText(standing.rank)}
              />
            ))}
          </section>
        )
      })}

      {confirmationsLost.length > 0 ? (
        <p className="text-[0.8125rem] text-destructive">
          {messages.impact.confirmationsLost(
            confirmationsLost.map((resolution) => messages.common.group(resolution.group)).join(' và '),
          )}
        </p>
      ) : null}
    </div>
  )
}
