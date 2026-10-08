import type { Pair, TournamentSnapshot, UUID } from '@/domain/types'
import { messages } from '@/i18n/messages'
import { cn } from '@/lib/utils'

import { playerName, teamName } from './labels'

export function TeamIdentity({ snapshot, teamId, className }: {
  snapshot: TournamentSnapshot
  teamId: UUID | null
  className?: string
}) {
  return <span className={cn('block min-w-0 font-semibold [overflow-wrap:anywhere]', className)}>{teamName(snapshot, teamId)}</span>
}

export function SeedLegend() {
  return (
    <p className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
      {([1, 2] as const).map((seed) => (
        <span className="seed-name inline-flex items-center gap-1.5 font-medium" data-seed={seed} key={seed}>
          <span className="numeric flex size-4 shrink-0 items-center justify-center rounded-full border border-current text-[0.625rem] leading-none" aria-hidden="true">{seed}</span>
          {messages.common.seed(seed)}
        </span>
      ))}
    </p>
  )
}

export function PlayerIdentity({ snapshot, playerId, showSeed = true, compact = false }: {
  snapshot: TournamentSnapshot
  playerId: UUID
  showSeed?: boolean
  compact?: boolean
}) {
  const player = snapshot.players.find((candidate) => candidate.id === playerId)
  return (
    <span className={cn('seed-name inline-flex min-w-0 max-w-full items-baseline gap-1.5 font-medium', compact ? 'text-sm' : 'text-base')} data-seed={player?.seed}>
      <span className="min-w-0 [overflow-wrap:anywhere]">{playerName(snapshot, playerId)}</span>
      {showSeed && player ? (
        <span className="numeric shrink-0 text-[0.625rem] font-bold" aria-label={messages.common.seed(player.seed)} title={messages.common.seed(player.seed)}>{player.seed}</span>
      ) : null}
    </span>
  )
}

export function PairDisplay({ snapshot, pair, compact = false, className }: {
  snapshot: TournamentSnapshot
  pair: Pair | null
  compact?: boolean
  className?: string
}) {
  if (pair === null) {
    return <span className={cn('block text-sm text-muted-ink', className)}>{messages.pairAssignment.notAssigned}</span>
  }
  return (
    <span className={cn('flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1', className)}>
      <PlayerIdentity snapshot={snapshot} playerId={pair.player1Id} compact={compact} />
      <span className="text-sm text-rule" aria-hidden="true">/</span>
      <PlayerIdentity snapshot={snapshot} playerId={pair.player2Id} compact={compact} />
    </span>
  )
}
