import { Trophy } from 'lucide-react'

import { fixtureWinnerTeamId } from '@/domain/team-fixtures'
import type { TournamentSnapshot } from '@/domain/types'
import { messages } from '@/i18n/vi'

import { FixtureCard } from './FixtureCard'
import { fixtureMatches, teamName, teamNames } from './labels'
import { FinalPositions } from './StandingsTable'

/**
 * Matchups a four-team round drew, as "A - B", so players can trace how a
 * team advanced. Advancement itself is never drawn.
 */
export function DrawOutcomeList({ snapshot }: { snapshot: TournamentSnapshot }) {
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
      <h4 className="text-[0.6875rem] font-semibold text-muted-ink">{messages.fixtures.drawOutcomesHeading}</h4>
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
function QualificationPlayoffs({ snapshot }: { snapshot: TournamentSnapshot }) {
  const rounds = snapshot.playoffRounds.toSorted((left, right) => left.roundNumber - right.roundNumber)
  if (rounds.length === 0) return null
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-[-0.033em]">{messages.fixtures.playoffHeading}</h2>
        <p className="mt-2 text-xs text-muted-ink">{messages.fixtures.playoffDescription}</p>
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
      <DrawOutcomeList snapshot={snapshot} />
    </section>
  )
}

export function KnockoutBracket({ snapshot }: { snapshot: TournamentSnapshot }) {
  const thirdPlace = snapshot.fixtures.find((fixture) => fixture.stage === 'third-place')
  const final = snapshot.fixtures.find((fixture) => fixture.stage === 'final')
  const championId = final ? fixtureWinnerTeamId(final, fixtureMatches(snapshot, final.id)) : null

  return (
    <section className="view-enter space-y-6">
      {championId ? (
        <div className="rounded-[2rem] bg-navy px-7 py-12 text-center text-white shadow-final">
          <Trophy className="mx-auto size-9 text-cyan" aria-hidden="true" />
          <p className="mt-5 text-xs font-semibold tracking-[0.12em] text-navy-soft">{messages.fixtures.championLabel}</p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-5xl">{teamName(snapshot, championId)}</h2>
        </div>
      ) : null}
      <QualificationPlayoffs snapshot={snapshot} />
      {championId ? null : (
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.033em]">{messages.fixtures.placementHeading}</h2>
          <p className="mt-2 text-xs text-muted-ink">{messages.fixtures.placementDescription}</p>
        </div>
      )}
      <div className="grid gap-6 md:grid-cols-2">
        <FixtureCard
          snapshot={snapshot}
          fixture={final}
          label={messages.stages.final}
          placeholders={{ a: messages.fixtures.awaitingFinalist, b: messages.fixtures.awaitingFinalist }}
          final
        />
        <FixtureCard
          snapshot={snapshot}
          fixture={thirdPlace}
          label={messages.stages['third-place']}
          placeholders={{ a: messages.fixtures.awaitingThirdPlace, b: messages.fixtures.awaitingThirdPlace }}
        />
      </div>
      <FinalPositions snapshot={snapshot} />
    </section>
  )
}
