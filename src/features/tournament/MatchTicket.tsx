import type { Match, TournamentSnapshot, UUID } from '@/domain/types'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

function playerName(snapshot: TournamentSnapshot, playerId: UUID): string {
  return snapshot.players.find((player) => player.id === playerId)?.name ?? 'Unknown player'
}

export function pairName(snapshot: TournamentSnapshot, pairId: UUID | null): string {
  if (pairId === null) return 'To be decided'
  const pair = snapshot.pairs.find((candidate) => candidate.id === pairId)
  if (!pair) return 'Unknown pair'
  return pair.teamName ?? `${playerName(snapshot, pair.playerAId)} / ${playerName(snapshot, pair.playerBId)}`
}

function pairSeeds(snapshot: TournamentSnapshot, pairId: UUID | null): string {
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
  return (
    <div className="min-w-0 text-center">
      <p className="truncate text-sm font-semibold">{pairId ? pairName(snapshot, pairId) : sideLabel(match, side)}</p>
      <p className="mt-1 text-[0.625rem] uppercase tracking-wider text-muted-foreground">
        {pairSeeds(snapshot, pairId)}
      </p>
      <strong
        className={cn(
          'numeric mt-4 block rounded-xl px-3 py-2 text-6xl font-bold tracking-[-0.08em]',
          side === 'a' ? 'bg-[#fcdfd4]' : 'bg-[#d3f2f3]',
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
        'ticket lift-card overflow-hidden rounded-[1.375rem] border-t-[5px] bg-white p-6 shadow-[0_7px_0_rgb(15_43_41/0.03)]',
        match.court === 2 ? 'border-t-[#23c0c3]' : 'border-t-[#f15d27]',
      )}
      style={{ '--ticket-cutout-top': '76%' } as React.CSSProperties}
      aria-label={match.court ? `Court ${match.court}` : `${match.round} match`}
    >
      <div className="mb-7 flex items-center justify-between gap-4">
        <h3 className="text-sm font-semibold">
          {match.court ? `Court ${match.court}` : match.round === 'final' ? 'The final' : 'Semifinal'}
        </h3>
        <Badge variant="outline" className="rounded-full text-[0.625rem] font-medium text-primary">
          {status}
        </Badge>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_1rem_minmax(0,1fr)] items-center gap-3">
        <TicketSide match={match} side="a" snapshot={snapshot} />
        <span className="mt-10 text-center text-muted-foreground" aria-hidden="true">:</span>
        <TicketSide match={match} side="b" snapshot={snapshot} />
      </div>
      <div className="mt-6 border-t border-dashed pt-4 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Order {match.playingOrder}</span>
        {nextLabel ? <span> · Up next: {nextLabel}</span> : null}
      </div>
    </article>
  )
}
