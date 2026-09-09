import type { Group, Match, TournamentSnapshot, UUID } from '@/domain/types'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/** "Group A" / "Semifinal" / "Final" — the round a match belongs to. */
export function matchRoundLabel(match: Match): string {
  if (match.round === 'group') return match.group ? `Group ${match.group}` : 'Group'
  return match.round === 'semifinal' ? 'Semifinal' : 'Final'
}

/** Group colour, shared by the ticket head, the bracket and the standings. */
export function groupTone(group: Group): string {
  return group === 'A' ? 'bg-mist text-navy' : 'bg-ice text-ink'
}

function playerName(snapshot: TournamentSnapshot, playerId: UUID): string {
  return snapshot.players.find((player) => player.id === playerId)?.name ?? 'Unknown player'
}

export function pairName(snapshot: TournamentSnapshot, pairId: UUID | null): string {
  if (pairId === null) return 'To be decided'
  const pair = snapshot.pairs.find((candidate) => candidate.id === pairId)
  if (!pair) return 'Unknown pair'
  return pair.teamName ?? pairPlayers(snapshot, pairId)
}

export function pairPlayers(snapshot: TournamentSnapshot, pairId: UUID | null): string {
  if (pairId === null) return 'Awaiting qualifier'
  const pair = snapshot.pairs.find((candidate) => candidate.id === pairId)
  if (!pair) return 'Unknown players'
  return `${playerName(snapshot, pair.playerAId)} / ${playerName(snapshot, pair.playerBId)}`
}

export function pairTeamName(snapshot: TournamentSnapshot, pairId: UUID | null): string | null {
  if (pairId === null) return null
  return snapshot.pairs.find((candidate) => candidate.id === pairId)?.teamName ?? null
}

export function pairSeeds(snapshot: TournamentSnapshot, pairId: UUID | null): string {
  if (pairId === null) return 'Awaiting qualifier'
  const pair = snapshot.pairs.find((candidate) => candidate.id === pairId)
  if (!pair) return 'Seed unavailable'
  const first = snapshot.players.find((player) => player.id === pair.playerAId)?.seed
  const second = snapshot.players.find((player) => player.id === pair.playerBId)?.seed
  return first && second ? `Seeds ${first} + ${second}` : 'Seeds unavailable'
}

function sideLabel(match: Match, side: 'a' | 'b'): string | null {
  return side === 'a' ? match.sourceALabel : match.sourceBLabel
}

function TicketSide({
  match,
  side,
  snapshot,
}: {
  match: Match
  side: 'a' | 'b'
  snapshot: TournamentSnapshot
}) {
  const pairId = side === 'a' ? match.pairAId : match.pairBId
  const score = match.score?.[side] ?? '–'
  const teamName = pairTeamName(snapshot, pairId)
  return (
    <div className="flex min-w-0 flex-col items-center text-center">
      <p className="truncate text-[0.9375rem] font-medium tracking-[-0.027em]">
        {pairId ? pairName(snapshot, pairId) : sideLabel(match, side)}
      </p>
      {teamName ? <p className="mt-1 truncate text-[0.6875rem] text-muted-ink">{pairPlayers(snapshot, pairId)}</p> : null}
      <p className="mt-1.5 text-[0.625rem] uppercase tracking-[0.08em] text-muted-ink">
        {pairSeeds(snapshot, pairId)}
      </p>
      <strong
        className={cn(
          'numeric mt-4 block min-w-28 rounded-[14px] text-[4.375rem]/[1.35] font-bold tracking-[-0.057em] shadow-[inset_0_1px_0_rgb(255_255_255/0.53)]',
          side === 'a' ? 'bg-peach' : 'bg-ice',
        )}
      >
        {score}
      </strong>
    </div>
  )
}

export function MatchTicket({
  match,
  snapshot,
  nextLabel,
}: {
  match: Match
  snapshot: TournamentSnapshot
  nextLabel?: string
}) {
  const status = match.state === 'playing' ? 'Playing' : match.state === 'completed' ? 'Finished' : 'Up next'
  return (
    <article
      className={cn(
        'ticket lift-card rounded-card border-t-[5px] bg-white p-[1.625rem] shadow-card',
        match.court === 2 ? 'border-t-cyan' : 'border-t-orange',
      )}
      aria-label={match.court ? `Court ${match.court}` : `${match.round} match`}
    >
      <div className="mb-7 flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <h3 className="text-sm font-semibold">
            {match.court ? `Court ${match.court}` : match.round === 'final' ? 'The final' : 'Semifinal'}
          </h3>
          {match.group ? (
            <span className={cn('shrink-0 rounded-pill px-2.5 py-1 text-[0.625rem] font-semibold', groupTone(match.group))}>
              Group {match.group}
            </span>
          ) : null}
        </div>
        <Badge variant="status" className={match.state === 'playing' ? 'text-navy' : 'text-muted-ink'}>
          {status}
        </Badge>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_1rem_minmax(0,1fr)] items-center gap-3">
        <TicketSide match={match} side="a" snapshot={snapshot} />
        <span className="mt-[1.875rem] text-center text-xl opacity-40" aria-hidden="true">:</span>
        <TicketSide match={match} side="b" snapshot={snapshot} />
      </div>
      <div className="tear -mx-[1.625rem] -mb-[1.625rem] mt-[1.9375rem] px-[1.625rem] pt-5 pb-[1.1875rem]">
        <small className="text-[0.625rem] text-muted-ink">Up next</small>
        <p className="mt-[7px] text-xs/[1.6]">
          <span className="font-medium">Order {match.playingOrder}</span>
          {nextLabel ? <span className="text-muted-ink"> · {nextLabel}</span> : null}
        </p>
      </div>
    </article>
  )
}
