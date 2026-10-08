import { finalPositions, isQualifyingComplete, placementParticipants } from '@/domain/progression'
import { qualifyingStandings, requiredPlayoff } from '@/domain/standings'
import type { PlayoffFormat, Seed, TeamStanding, TournamentSnapshot } from '@/domain/types'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatNumber } from '@/i18n/format'
import { messages } from '@/i18n/vi'
import { cn } from '@/lib/utils'

import { PlayerIdentity, SeedLegend, TeamIdentity } from './Participants'
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
    <section className="rounded-card border border-ink/5 bg-white p-4 sm:p-6 shadow-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[0.9375rem] font-semibold">{messages.fixtures.standingsHeading}</h3>
        <span
          className={cn(
            'rounded-pill px-2.5 py-1 text-xs font-semibold',
            status.kind === 'confirmed' ? 'bg-navy text-white' : status.kind === 'provisional' ? 'bg-well text-muted-ink' : 'bg-peach text-ink',
          )}
          role="status"
        >
          {statusText(status)}
        </span>
      </div>
      <ol className="space-y-3 sm:hidden">
        {standings.map((standing) => (
          <li className="rounded-field bg-well p-4" key={standing.teamId}>
            <div className="flex items-start gap-3">
              <span className="numeric flex size-8 shrink-0 items-center justify-center rounded-chip bg-mist font-bold text-navy">
                {formatNumber(standing.rank)}{sharedRank(standing) ? '=' : ''}
              </span>
              <div className="min-w-0">
                <TeamIdentity snapshot={snapshot} teamId={standing.teamId} className="text-sm" />
                {sharedRank(standing) ? <p className="mt-1 text-xs text-muted-ink">{messages.fixtures.unseparated}</p> : null}
                {!sharedRank(standing) && standing.separatedBy !== null && standing.separatedBy !== 'match-wins' ? (
                  <p className="mt-1 text-xs text-muted-ink">{messages.fixtures.separatedBy[standing.separatedBy]}</p>
                ) : null}
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs text-muted-ink">
              <div><dt>{messages.fixtures.columns.matchWins}</dt><dd className="numeric mt-1 text-lg font-semibold text-ink">{formatNumber(standing.matchWins)}</dd></div>
              <div><dt>{messages.fixtures.columns.pointDifference}</dt><dd className="numeric mt-1 text-lg font-semibold text-ink">{standing.pointDifference > 0 ? '+' : ''}{formatNumber(standing.pointDifference)}</dd></div>
              <div><dt>{messages.fixtures.columns.pointsScored}</dt><dd className="numeric mt-1 font-semibold text-ink">{formatNumber(standing.pointsScored)}</dd></div>
              <div><dt>{messages.fixtures.columns.pointsConceded}</dt><dd className="numeric mt-1 font-semibold text-ink">{formatNumber(standing.pointsConceded)}</dd></div>
            </dl>
          </li>
        ))}
      </ol>
      <div className="hidden sm:block">
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
                    <TeamIdentity snapshot={snapshot} teamId={standing.teamId} className="text-sm" />
                    {shared ? (
                      <span className="mt-0.5 block text-xs text-muted-ink">{messages.fixtures.unseparated}</span>
                    ) : separatedBy !== null && separatedBy !== 'match-wins' ? (
                      <span className="mt-0.5 block text-xs text-muted-ink">{messages.fixtures.separatedBy[separatedBy]}</span>
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
      </div>
      {anyShared ? <p className="mt-4 text-xs text-muted-ink">{messages.fixtures.unseparatedNote}</p> : null}
    </section>
  )
}

export function FinalPositions({ snapshot }: { snapshot: TournamentSnapshot }) {
  const positions = finalPositions(snapshot.fixtures, snapshot.matches)
  if (positions === null) return null
  return (
    <section className="rounded-card border border-line bg-white p-4 sm:p-6">
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

function TeamRoster({ snapshot }: { snapshot: TournamentSnapshot }) {
  return (
    <section>
      <h3 className="mb-4 text-lg font-semibold">{messages.fixtures.teamsHeading}</h3>
      <div className="grid gap-x-8 sm:grid-cols-2">
        {snapshot.teams.map((team) => {
          const players = snapshot.players
            .filter((player) => player.teamId === team.id)
            .toSorted((first, second) => first.name.localeCompare(second.name, 'vi'))
          return (
            <article className="min-w-0 border-t border-line py-5" key={team.id}>
              <h4 className="text-lg font-bold [overflow-wrap:anywhere]">{team.name}</h4>
              {players.length === 0 ? (
                <p className="mt-3 text-sm text-muted-ink">{messages.fixtures.noPlayers}</p>
              ) : (
                <div className="mt-4 grid grid-cols-2 gap-4">
                  {seeds.map((seed) => (
                    <div key={seed}>
                      <p className="mb-2 text-xs font-medium text-muted-ink">{messages.common.seed(seed)}</p>
                      <ul className="space-y-2">
                        {players.filter((player) => player.seed === seed).map((player) => (
                          <li key={player.id}><PlayerIdentity snapshot={snapshot} playerId={player.id} showSeed={false} /></li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}

export function StandingsTable({ snapshot }: { snapshot: TournamentSnapshot }) {
  return (
    <section className="view-enter space-y-6">
      <h2 className="sr-only">{messages.fixtures.standingsHeading}</h2>
      <SeedLegend />
      <QualifyingStandings snapshot={snapshot} />
      <TeamRoster snapshot={snapshot} />
    </section>
  )
}
