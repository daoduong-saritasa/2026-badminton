import { finalPositions, isQualifyingComplete, placementParticipants } from '@/domain/progression'
import { qualifyingStandings, requiredPlayoff } from '@/domain/standings'
import type { PlayoffFormat, Seed, TeamStanding, TournamentSnapshot } from '@/domain/types'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatNumber } from '@/i18n/format'
import { messages } from '@/i18n/vi'
import { cn } from '@/lib/utils'

import { FixtureCard } from './FixtureCard'
import { fixtureMatches, teamName } from './labels'

type QualificationStatus =
  | { kind: 'provisional' }
  | { kind: 'playoff'; format: PlayoffFormat }
  | { kind: 'draw-pending' }
  | { kind: 'awaiting-confirmation' }
  | { kind: 'confirmed' }

/** Where qualification stands: provisional, waiting on a playoff or draw, or settled. */
function qualificationStatus(snapshot: TournamentSnapshot, standings: readonly TeamStanding[]): QualificationStatus {
  if (!isQualifyingComplete(snapshot)) return { kind: 'provisional' }
  const participants = placementParticipants(snapshot)
  if (participants) return { kind: participants.confirmed ? 'confirmed' : 'awaiting-confirmation' }
  const playoff = requiredPlayoff(standings)
  if (!playoff) return { kind: 'provisional' }
  const playoffMatches = snapshot.fixtures
    .filter((fixture) => fixture.stage === 'qualification-playoff')
    .flatMap((fixture) => fixtureMatches(snapshot, fixture.id))
  if (playoff.format === 'three-team' && playoffMatches.length === 3 && playoffMatches.every((match) => match.state === 'completed')) {
    return { kind: 'draw-pending' }
  }
  return { kind: 'playoff', format: playoff.format }
}

function statusText(status: QualificationStatus): string {
  switch (status.kind) {
    case 'provisional':
      return messages.fixtures.status.provisional
    case 'playoff':
      return messages.fixtures.status.playoff[status.format]
    case 'draw-pending':
      return messages.fixtures.status.drawPending
    case 'awaiting-confirmation':
      return messages.fixtures.status.awaitingConfirmation
    case 'confirmed':
      return messages.fixtures.status.confirmed
  }
}

/**
 * The round-robin table. Teams the criteria left level share a rank and carry
 * a marker; a team that a tie-break separated names the criterion that did it.
 */
function QualifyingStandings({ snapshot }: { snapshot: TournamentSnapshot }) {
  const standings = qualifyingStandings(snapshot.fixtures, snapshot.matches, snapshot.teams)
  const status = qualificationStatus(snapshot, standings)
  const sharedRank = (standing: TeamStanding) =>
    standings.some((other) => other.teamId !== standing.teamId && other.rank === standing.rank)
  const anyShared = standings.some(sharedRank)

  return (
    <section className="rounded-card border border-ink/5 bg-white p-6 shadow-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[0.9375rem] font-semibold">{messages.fixtures.standingsHeading}</h3>
        <span
          className={cn(
            'rounded-pill px-2.5 py-1 text-[0.625rem] font-semibold',
            status.kind === 'confirmed' ? 'bg-navy text-white' : status.kind === 'provisional' ? 'bg-well text-muted-ink' : 'bg-peach text-ink',
          )}
          role="status"
        >
          {statusText(status)}
        </span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-14 pl-0">{messages.fixtures.columns.rank}</TableHead>
            <TableHead>{messages.fixtures.columns.team}</TableHead>
            <TableHead className="text-right">{messages.fixtures.columns.matchWins}</TableHead>
            <TableHead className="text-right">{messages.fixtures.columns.pointsScored}</TableHead>
            <TableHead className="text-right">{messages.fixtures.columns.pointsConceded}</TableHead>
            <TableHead className="pr-0 text-right">{messages.fixtures.columns.pointDifference}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {standings.map((standing) => {
            const shared = sharedRank(standing)
            const separatedBy = standing.separatedBy
            return (
              <TableRow className="border-t border-hairline first:border-t-0" key={standing.teamId}>
                <TableCell className="numeric pl-0 font-semibold">
                  {formatNumber(standing.rank)}
                  {shared ? <span className="ml-1 text-muted-ink" aria-label={messages.fixtures.unseparated}>=</span> : null}
                </TableCell>
                <TableCell className="min-w-36 whitespace-normal">
                  <span className="block font-medium [overflow-wrap:anywhere]">{teamName(snapshot, standing.teamId)}</span>
                  {shared ? (
                    <span className="mt-0.5 block text-[0.625rem] text-muted-ink">{messages.fixtures.unseparated}</span>
                  ) : separatedBy !== null && separatedBy !== 'match-wins' ? (
                    <span className="mt-0.5 block text-[0.625rem] text-muted-ink">{messages.fixtures.separatedBy[separatedBy]}</span>
                  ) : null}
                </TableCell>
                <TableCell className="numeric text-right font-semibold">{formatNumber(standing.matchWins)}</TableCell>
                <TableCell className="numeric text-right">{formatNumber(standing.pointsScored)}</TableCell>
                <TableCell className="numeric text-right">{formatNumber(standing.pointsConceded)}</TableCell>
                <TableCell className="numeric pr-0 text-right">
                  {standing.pointDifference > 0 ? '+' : ''}{formatNumber(standing.pointDifference)}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {anyShared ? <p className="mt-4 text-[0.6875rem] text-muted-ink">{messages.fixtures.unseparatedNote}</p> : null}
    </section>
  )
}

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

const seeds: readonly Seed[] = [1, 2]

/** Seed 1 reads as the filled chip, seed 2 as the light one; the label carries the meaning. */
function seedTone(seed: Seed): string {
  return seed === 1 ? 'bg-navy text-white' : 'bg-mist text-navy'
}

/** Each team with its players listed under their seed. */
function TeamRoster({ snapshot }: { snapshot: TournamentSnapshot }) {
  return (
    <section className="rounded-card border border-line bg-white p-6">
      <h3 className="mb-4 text-[0.9375rem] font-semibold">{messages.fixtures.teamsHeading}</h3>
      <div className="grid gap-5 sm:grid-cols-2">
        {snapshot.teams.map((team) => {
          const players = snapshot.players
            .filter((player) => player.teamId === team.id)
            .toSorted((first, second) => first.name.localeCompare(second.name, 'vi'))
          return (
            <div className="min-w-0" key={team.id}>
              <h4 className="mb-2 text-[0.8125rem] font-semibold [overflow-wrap:anywhere]">{team.name}</h4>
              {players.length === 0 ? (
                <p className="text-[0.6875rem] text-muted-ink">{messages.fixtures.noPlayers}</p>
              ) : (
                <dl className="space-y-2">
                  {seeds.map((seed) => (
                    <div className="grid gap-1" key={seed}>
                      <dt>
                        <span className={cn('inline-block rounded-chip px-2 py-0.5 text-[0.625rem] font-bold', seedTone(seed))}>
                          {messages.common.seed(seed)}
                        </span>
                      </dt>
                      {players
                        .filter((player) => player.seed === seed)
                        .map((player) => (
                          <dd className="pl-2 text-[0.8125rem] [overflow-wrap:anywhere]" key={player.id}>{player.name}</dd>
                        ))}
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function StandingsTable({ snapshot }: { snapshot: TournamentSnapshot }) {
  return (
    <section className="view-enter space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-[-0.033em]">{messages.fixtures.qualifyingHeading}</h2>
        <p className="mt-2 text-xs text-muted-ink">{messages.fixtures.qualifyingDescription}</p>
      </div>
      <QualifyingStandings snapshot={snapshot} />
      <div className="grid gap-6 md:grid-cols-2">
        {snapshot.fixtures
          .filter((fixture) => fixture.stage === 'qualifying')
          .map((fixture) => <FixtureCard key={fixture.id} snapshot={snapshot} fixture={fixture} />)}
      </div>
      <TeamRoster snapshot={snapshot} />
      <FinalPositions snapshot={snapshot} />
    </section>
  )
}
