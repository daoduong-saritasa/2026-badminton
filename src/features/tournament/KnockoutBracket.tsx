import { Trophy } from 'lucide-react'

import { qualificationCutoff, qualifyingStandings, threeTeamPlayoffOutcome } from '@/domain/standings'
import { fixtureWinnerTeamId } from '@/domain/team-fixtures'
import type { TournamentSnapshot, UUID } from '@/domain/types'
import { messages } from '@/i18n/vi'

import { FixtureCard } from './FixtureCard'
import { fixtureMatches, teamName, teamNames } from './labels'
import { FinalPositions } from './StandingsTable'

interface DrawOutcomes {
  /** Matchups a four-team tie drew, as "A - B". */
  matchups: string[]
  /** Teams a three-team playoff's supervised draw sent to the final. */
  advancedTeamIds: UUID[]
}

/**
 * The published results of any supervised draw, so players can trace how a
 * team advanced. Empty when no draw has decided anything.
 */
function drawOutcomes(snapshot: TournamentSnapshot): DrawOutcomes {
  const playoffs = snapshot.fixtures.filter((fixture) => fixture.stage === 'qualification-playoff')
  const cutoff = qualificationCutoff(qualifyingStandings(snapshot.fixtures, snapshot.matches, snapshot.teams))
  const tiedCount = cutoff?.tiedTeamIds.length ?? 0

  const matchups = tiedCount === 4
    ? playoffs.flatMap((fixture) => fixture.teamAId && fixture.teamBId
      ? [messages.common.versus(teamName(snapshot, fixture.teamAId), teamName(snapshot, fixture.teamBId))]
      : [])
    : []

  const outcome = cutoff && tiedCount === 3 && playoffs.length === 3
    ? threeTeamPlayoffOutcome(playoffs, snapshot.matches, cutoff.tiedTeamIds, cutoff.availablePlaces)
    : null
  const advancedTeamIds = outcome && outcome.drawSlots > 0
    ? (snapshot.tournament.qualificationDrawWinnerIds ?? []).filter((teamId) => !outcome.automaticTeamIds.includes(teamId))
    : []

  return { matchups, advancedTeamIds }
}

export function DrawOutcomeList({ snapshot }: { snapshot: TournamentSnapshot }) {
  const { matchups, advancedTeamIds } = drawOutcomes(snapshot)
  if (matchups.length === 0 && advancedTeamIds.length === 0) return null
  return (
    <div>
      <h4 className="text-[0.6875rem] font-semibold text-muted-ink">{messages.fixtures.drawOutcomesHeading}</h4>
      <ul className="mt-2 space-y-1 text-[0.8125rem]">
        {matchups.map((matchup) => <li key={matchup}>{messages.fixtures.matchupDrawn(matchup)}</li>)}
        {advancedTeamIds.length > 0 ? <li>{messages.fixtures.advancedByDraw(teamNames(snapshot, advancedTeamIds))}</li> : null}
      </ul>
    </div>
  )
}

function QualificationPlayoffs({ snapshot }: { snapshot: TournamentSnapshot }) {
  const playoffs = snapshot.fixtures.filter((fixture) => fixture.stage === 'qualification-playoff')
  if (playoffs.length === 0) return null
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-[-0.033em]">{messages.fixtures.playoffHeading}</h2>
        <p className="mt-2 text-xs text-muted-ink">{messages.fixtures.playoffDescription}</p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {playoffs.map((fixture) => (
          <FixtureCard
            key={fixture.id}
            snapshot={snapshot}
            fixture={fixture}
            placeholders={{ a: messages.fixtures.awaitingDraw, b: messages.fixtures.awaitingDraw }}
          />
        ))}
      </div>
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
