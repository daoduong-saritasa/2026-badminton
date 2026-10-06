import type { FixtureMatch, TournamentSnapshot } from '@/domain/types'
import { messages } from '@/i18n/vi'
import { cn } from '@/lib/utils'

import { matchPair, pairPlayers } from './labels'

/**
 * A match's two pairs on separate lines, side A first, so they read in the
 * same order as the fixture's teams. One line says neither is assigned yet.
 */
export function PairLines({ snapshot, match, className }: {
  snapshot: TournamentSnapshot
  match: FixtureMatch
  className?: string
}) {
  if (match.pairA === null && match.pairB === null) {
    return <p className={cn('text-[0.8125rem] text-muted-ink', className)}>{messages.pairAssignment.notAssigned}</p>
  }
  return (
    <ul className={cn('min-w-0 space-y-0.5 text-[0.8125rem]', className)}>
      {(['a', 'b'] as const).map((side) => {
        const pair = matchPair(match, side)
        return (
          <li className={cn('[overflow-wrap:anywhere]', pair ? 'font-medium text-ink' : 'text-muted-ink')} key={side}>
            {pair ? pairPlayers(snapshot, pair) : messages.pairAssignment.notAssigned}
          </li>
        )
      })}
    </ul>
  )
}
