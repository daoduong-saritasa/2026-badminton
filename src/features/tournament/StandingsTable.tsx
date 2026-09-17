import { finalPositions } from '@/domain/progression'
import type { TournamentSnapshot } from '@/domain/types'
import { messages } from '@/i18n/vi'

import { FixtureCard } from './FixtureCard'
import { teamName } from './labels'

export function FinalPositions({ snapshot }: { snapshot: TournamentSnapshot }) {
  const positions = finalPositions(snapshot.fixtures, snapshot.matches)
  if (positions === null) return null
  return (
    <section className="rounded-card border border-line bg-white p-6">
      <h3 className="mb-4 text-[0.9375rem] font-semibold">{messages.fixtures.positionsHeading}</h3>
      <ol className="space-y-2">
        {positions.map((teamId, index) => (
          <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 text-[0.8125rem]" key={teamId}>
            <span className="text-muted-ink">{messages.fixtures.position(index + 1)}</span>
            <span className="font-medium [overflow-wrap:anywhere]">{teamName(snapshot, teamId)}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function StandingsTable({ snapshot }: { snapshot: TournamentSnapshot }) {
  return (
    <section className="view-enter space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-[-0.033em]">{messages.fixtures.groupHeading}</h2>
        <p className="mt-2 text-xs text-muted-ink">{messages.fixtures.groupDescription}</p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {(['A', 'B'] as const).map((group) => (
          <FixtureCard
            key={group}
            snapshot={snapshot}
            fixture={snapshot.fixtures.find((fixture) => fixture.stage === 'group' && fixture.group === group)}
          />
        ))}
      </div>
      <FinalPositions snapshot={snapshot} />
    </section>
  )
}
