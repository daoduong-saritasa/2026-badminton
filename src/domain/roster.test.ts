import { describe, expect, it } from 'vitest'

import { validateRoster } from './roster'
import type { Team, TeamPlayer } from './types'

const teams: Team[] = [
  { id: 't1', name: 'T1' },
  { id: 't2', name: 'T2' },
  { id: 't3', name: 'T3' },
  { id: 't4', name: 'T4' },
]

const players: TeamPlayer[] = teams.flatMap((team) => [
  { id: `${team.id}-s1a`, name: 'Seed 1 A', seed: 1, teamId: team.id },
  { id: `${team.id}-s1b`, name: 'Seed 1 B', seed: 1, teamId: team.id },
  { id: `${team.id}-s2a`, name: 'Seed 2 A', seed: 2, teamId: team.id },
  { id: `${team.id}-s2b`, name: 'Seed 2 B', seed: 2, teamId: team.id },
])

describe('validateRoster', () => {
  it('accepts four teams of four distinct players with balanced seeds', () => {
    expect(validateRoster(teams, players)).toEqual([])
  })

  it('reports invalid team, player, seed, and membership counts', () => {
    const invalidTeams = teams.slice(0, 3)
    const invalidPlayers = [
      ...players.slice(1, 15),
      { ...players[1], teamId: 'missing' },
    ]

    expect(validateRoster(invalidTeams, invalidPlayers).map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'team-count',
        'player-count',
        'duplicate-player',
        'unknown-team',
        'team-size',
        'seed-split',
      ]),
    )
  })
})
