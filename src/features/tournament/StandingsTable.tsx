import type { Group, TournamentSnapshot } from '@/domain/types'
import { calculateStandings } from '@/domain/standings'
import { formatNumber } from '@/i18n/format'
import { messages } from '@/i18n/vi'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { groupTone, pairName, pairPlayers, pairSeeds, pairTeamName } from './MatchTicket'

function GroupTable({ group, snapshot }: { group: Group; snapshot: TournamentSnapshot }) {
  const standings = calculateStandings(snapshot, group)
  return (
    <section className="rounded-card border border-line bg-white p-6">
      <h3 className="mb-4 flex items-center gap-2.5 text-[0.9375rem] font-semibold">
        <span className={cn('grid size-[1.625rem] place-items-center rounded-chip text-[0.625rem] font-bold', groupTone(group))}>{group}</span>
        {messages.common.group(group)}
      </h3>
      {/* Pulled out by the cell padding so the text still lines up with the
          heading, while a highlighted row extends past it on both sides. */}
      <div className="-mx-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{messages.standings.pair}</TableHead>
              <TableHead className="text-right"><abbr title={messages.standings.played}>{messages.standings.playedShort}</abbr></TableHead>
              <TableHead className="text-right"><abbr title={messages.standings.wins}>{messages.standings.winsShort}</abbr></TableHead>
              <TableHead className="text-right"><abbr title={messages.standings.difference}>{messages.standings.differenceShort}</abbr></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {standings.map((standing) => (
              <TableRow
                className={cn(
                  standing.rank !== null && standing.rank <= 2
                    && 'bg-navy/5 [&>td:first-child]:rounded-l-chip [&>td:last-child]:rounded-r-chip',
                )}
                key={standing.pairId}
              >
                <TableCell className="max-w-44 font-medium">
                  <span>{pairName(snapshot, standing.pairId)}</span>
                  <span className="mt-1 block truncate text-[0.625rem] font-normal text-muted-ink">
                    {pairTeamName(snapshot, standing.pairId) ? `${pairPlayers(snapshot, standing.pairId)} · ` : ''}{pairSeeds(snapshot, standing.pairId)}
                  </span>
                </TableCell>
                <TableCell className="numeric text-right">{formatNumber(standing.played)}</TableCell>
                <TableCell className="numeric text-right">{formatNumber(standing.wins)}</TableCell>
                <TableCell className="numeric text-right">{formatNumber(standing.pointDifference)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

export function StandingsTable({ snapshot }: { snapshot: TournamentSnapshot }) {
  return (
    <section className="view-enter">
      <div className="mb-5">
        <h2 className="text-lg font-semibold tracking-[-0.033em]">{messages.standings.heading}</h2>
        <p className="mt-2 text-xs text-muted-ink">{messages.standings.description}</p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <GroupTable group="A" snapshot={snapshot} />
        <GroupTable group="B" snapshot={snapshot} />
      </div>
    </section>
  )
}
