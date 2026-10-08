import type { TournamentSnapshot, UUID } from '@/domain/types'
import { messages } from '@/i18n/vi'

import { FixtureCard } from './FixtureCard'
import { teamName, teamNames } from './labels'

function involves(snapshot: TournamentSnapshot, fixtureId: UUID, teamId: UUID): boolean {
  const fixture = snapshot.fixtures.find((candidate) => candidate.id === fixtureId)
  return fixture?.teamAId === teamId || fixture?.teamBId === teamId
}

/**
 * Matchups a four-team round drew, as "A - B", so players can trace how a
 * team advanced. Advancement itself is never drawn.
 */
function DrawOutcomeList({ snapshot }: { snapshot: TournamentSnapshot }) {
  const matchups = snapshot.playoffRounds
    .filter((round) => round.teamIds.length === 4)
    .flatMap((round) => round.fixtureIds)
    .flatMap((fixtureId) => {
      const fixture = snapshot.fixtures.find((candidate) => candidate.id === fixtureId)
      return fixture?.teamAId && fixture.teamBId
        ? [messages.common.versus(teamName(snapshot, fixture.teamAId), teamName(snapshot, fixture.teamBId))]
        : []
    })
  if (matchups.length === 0) return null
  return (
    <div>
      <h4 className="text-xs font-semibold text-muted-ink">{messages.fixtures.drawOutcomesHeading}</h4>
      <ul className="mt-2 space-y-1 text-[0.8125rem]">
        {matchups.map((matchup) => <li key={matchup}>{messages.fixtures.matchupDrawn(matchup)}</li>)}
      </ul>
    </div>
  )
}

/**
 * Every playoff round in order. Earlier rounds keep their results on view; a
 * continuation round says which teams play on and for how many places.
 */
export function QualificationPlayoffs({ snapshot, teamId = null }: {
  snapshot: TournamentSnapshot
  /** Team whose fixtures to show; null shows every fixture. */
  teamId?: UUID | null
}) {
  const rounds = snapshot.playoffRounds
    .toSorted((left, right) => left.roundNumber - right.roundNumber)
    .map((round) => ({ ...round, fixtureIds: round.fixtureIds.filter((fixtureId) => teamId === null || involves(snapshot, fixtureId, teamId)) }))
    .filter((round) => round.fixtureIds.length > 0)
  if (rounds.length === 0) return null
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{messages.fixtures.playoffHeading}</h2>
      </div>
      {rounds.map((round) => (
        <div className="space-y-3" key={round.id}>
          {rounds.length > 1 ? (
            <div>
              <h3 className="text-sm font-semibold">{messages.fixtures.playoffRound(round.roundNumber)}</h3>
              {round.roundNumber > 1 ? (
                <p className="mt-1 text-xs text-muted-ink">
                  {messages.fixtures.playOn(teamNames(snapshot, round.teamIds), round.availablePlaces)}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-6 md:grid-cols-2">
            {round.fixtureIds.map((fixtureId) => (
              <FixtureCard
                key={fixtureId}
                snapshot={snapshot}
                fixture={snapshot.fixtures.find((fixture) => fixture.id === fixtureId)}
                placeholders={{ a: messages.fixtures.awaitingDraw, b: messages.fixtures.awaitingDraw }}
              />
            ))}
          </div>
        </div>
      ))}
      {teamId === null ? <DrawOutcomeList snapshot={snapshot} /> : null}
    </section>
  )
}
