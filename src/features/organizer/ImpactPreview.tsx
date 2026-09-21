import { ArrowRight } from 'lucide-react'

import type { MutationImpact } from '@/domain/impacts'
import type { FixtureMatch, TournamentSnapshot, UUID } from '@/domain/types'
import {
  confirmedGames,
  fixtureLabel,
  fixtureScore,
  matchLabel,
  matchResultText,
  scoreText,
  sideTeamId,
  teamName,
} from '@/features/tournament/labels'
import { messages } from '@/i18n/vi'

function matchById(snapshot: TournamentSnapshot, id: UUID): FixtureMatch | undefined {
  return snapshot.matches.find((match) => match.id === id)
}

function outcomeText(snapshot: TournamentSnapshot, match: FixtureMatch | undefined): string {
  return match ? matchResultText(snapshot, match) : '—'
}

function gamesText(match: FixtureMatch | undefined): string {
  if (!match) return '—'
  return confirmedGames(match).map((game) => scoreText(game.score)).join(', ') || '—'
}

function Row({ label, before, after }: { label: string; before: string; after: string }) {
  const changed = before !== after
  return (
    <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 border-t border-hairline py-2 first-of-type:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
      <span className="col-span-full min-w-0 truncate text-[0.75rem] font-medium sm:col-span-1" title={label}>{label}</span>
      <span className="text-[0.75rem] text-muted-ink">{before}</span>
      <ArrowRight className="size-3.5 text-dim-ink" aria-hidden="true" />
      <span className="sr-only">{messages.impact.becomes}</span>
      <span
        className={changed
          ? 'justify-self-start rounded-chip bg-peach px-2 py-0.5 text-[0.75rem] font-semibold text-ink'
          : 'justify-self-start text-[0.75rem] text-muted-ink'}
      >
        {after}
      </span>
    </div>
  )
}

function placementText(snapshot: TournamentSnapshot, stage: 'third-place' | 'final'): string {
  const fixture = snapshot.fixtures.find((candidate) => candidate.stage === stage)
  if (!fixture) return messages.common.toBeDecided
  return messages.common.versus(teamName(snapshot, fixture.teamAId), teamName(snapshot, fixture.teamBId))
}

/**
 * Renders the server's own projection. Nothing here recomputes what the
 * tournament would become — a second derivation could disagree with the change
 * the confirm button actually sends.
 */
export function ImpactPreview({ impact, matchId }: { impact: MutationImpact; matchId: UUID }) {
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

  const changedMatches = after.matches.filter((match) =>
    match.id !== matchId && outcomeText(before, matchById(before, match.id)) !== outcomeText(after, match))
  const removedMatches = before.matches.filter((match) => !matchById(after, match.id))
  const corrected = matchById(after, matchId)
  const fixtures = after.fixtures.filter((fixture) => fixture.stage === 'qualifying')

  return (
    <div className="max-h-[50dvh] space-y-4 overflow-y-auto pr-1">
      <section>
        <h4 className="text-[0.6875rem] font-semibold text-muted-ink">{messages.impact.games}</h4>
        <Row
          label={corrected ? matchLabel(after, corrected) : messages.common.unknownMatch}
          before={gamesText(matchById(before, matchId))}
          after={gamesText(matchById(after, matchId))}
        />
      </section>

      {changedMatches.length + removedMatches.length > 0 ? (
        <section>
          <h4 className="text-[0.6875rem] font-semibold text-muted-ink">
            {messages.impact.affectedMatches(changedMatches.length + removedMatches.length)}
          </h4>
          {changedMatches.map((match) => (
            <Row
              key={match.id}
              label={matchLabel(after, match)}
              before={outcomeText(before, matchById(before, match.id))}
              after={outcomeText(after, match)}
            />
          ))}
          {removedMatches.map((match) => (
            <Row key={match.id} label={matchLabel(before, match)} before={outcomeText(before, match)} after="—" />
          ))}
        </section>
      ) : null}

      <section>
        <h4 className="text-[0.6875rem] font-semibold text-muted-ink">{messages.impact.fixtures}</h4>
        {fixtures.map((fixture) => (
          <Row
            key={fixture.id}
            label={`${fixtureLabel(fixture)} · ${messages.common.versus(teamName(after, sideTeamId(fixture, 'a')), teamName(after, sideTeamId(fixture, 'b')))}`}
            before={scoreText(fixtureScore(before, fixture.id))}
            after={scoreText(fixtureScore(after, fixture.id))}
          />
        ))}
      </section>

      <section>
        <h4 className="text-[0.6875rem] font-semibold text-muted-ink">{messages.impact.placements}</h4>
        <Row
          label={messages.stages.final}
          before={placementText(before, 'final')}
          after={placementText(after, 'final')}
        />
        <Row
          label={messages.stages['third-place']}
          before={placementText(before, 'third-place')}
          after={placementText(after, 'third-place')}
        />
      </section>
    </div>
  )
}
