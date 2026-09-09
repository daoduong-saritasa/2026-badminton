import type { Group, TournamentSnapshot } from '@/domain/types'
import { calculateStandings } from '@/domain/standings'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { pairName } from './MatchTicket'

function GroupTable({ group, snapshot }: { group: Group; snapshot: TournamentSnapshot }) {
  const standings = calculateStandings(snapshot, group)
  return (
    <section className="rounded-[1.375rem] border bg-white p-5 shadow-[0_6px_0_rgb(15_43_41/0.03)]">
      <h3 className="mb-4 text-sm font-semibold">Group {group}</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Pair</TableHead>
            <TableHead className="text-right">P</TableHead>
            <TableHead className="text-right">W</TableHead>
            <TableHead className="text-right">±</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {standings.map((standing) => (
            <TableRow key={standing.pairId}>
              <TableCell className="max-w-44 font-medium">
                <span className="mr-2 text-[0.625rem] text-muted-foreground">
                  {standing.rank ?? '–'}
                </span>
                {pairName(snapshot, standing.pairId)}
              </TableCell>
              <TableCell className="numeric text-right">{standing.played}</TableCell>
              <TableCell className="numeric text-right">{standing.wins}</TableCell>
              <TableCell className="numeric text-right">{standing.pointDifference}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}

export function StandingsTable({ snapshot }: { snapshot: TournamentSnapshot }) {
  return (
    <section className="view-enter">
      <div className="mb-5">
        <h2 className="text-lg font-semibold tracking-tight">Group standings</h2>
        <p className="mt-1 text-xs text-muted-foreground">Top two pairs advance from each group.</p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <GroupTable group="A" snapshot={snapshot} />
        <GroupTable group="B" snapshot={snapshot} />
      </div>
    </section>
  )
}
