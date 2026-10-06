import type { FixtureMatch, TournamentSnapshot } from '@/domain/types'
import { messages } from '@/i18n/vi'
import { cn } from '@/lib/utils'

import { fixtureOf, matchPair, sideTeamId } from './labels'
import { PairDisplay, TeamIdentity } from './Participants'

export function PairLines({ snapshot, match, className }: {
  snapshot: TournamentSnapshot
  match: FixtureMatch
  className?: string
}) {
  const fixture = fixtureOf(snapshot, match)
  if (match.pairA === null && match.pairB === null) {
    return <p className={cn('rounded-field border border-dashed border-line px-3 py-2 text-xs text-muted-ink', className)}>{messages.pairAssignment.notAssigned}</p>
  }
  return (
    <ul className={cn('grid min-w-0 gap-4 sm:grid-cols-2 sm:gap-x-6', className)}>
      {(['a', 'b'] as const).map((side) => (
        <li className="min-w-0" key={side}>
          <TeamIdentity snapshot={snapshot} teamId={sideTeamId(fixture, side)} className="mb-1.5 text-xs text-muted-ink" />
          <PairDisplay snapshot={snapshot} pair={matchPair(match, side)} compact />
        </li>
      ))}
    </ul>
  )
}
