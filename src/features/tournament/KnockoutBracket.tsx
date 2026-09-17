import { Trophy } from 'lucide-react'

import { fixtureWinnerTeamId } from '@/domain/team-fixtures'
import type { TournamentSnapshot } from '@/domain/types'
import { messages } from '@/i18n/vi'

import { FixtureCard } from './FixtureCard'
import { fixtureMatches, teamName } from './labels'
import { FinalPositions } from './StandingsTable'

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
      ) : (
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
          placeholders={{ a: messages.fixtures.awaitingGroupWinner('A'), b: messages.fixtures.awaitingGroupWinner('B') }}
          final
        />
        <FixtureCard
          snapshot={snapshot}
          fixture={thirdPlace}
          label={messages.stages['third-place']}
          placeholders={{ a: messages.fixtures.awaitingGroupLoser('A'), b: messages.fixtures.awaitingGroupLoser('B') }}
        />
      </div>
      <FinalPositions snapshot={snapshot} />
    </section>
  )
}
