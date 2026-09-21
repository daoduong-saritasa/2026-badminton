import { finalPositions } from '@/domain/progression'
import type { Seed, TournamentSnapshot } from '@/domain/types'
import { messages } from '@/i18n/vi'
import { cn } from '@/lib/utils'

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
        <h2 className="text-lg font-semibold tracking-[-0.033em]">{messages.fixtures.groupHeading}</h2>
        <p className="mt-2 text-xs text-muted-ink">{messages.fixtures.groupDescription}</p>
      </div>
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
