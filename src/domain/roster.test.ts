import { describe, expect, it } from 'vitest'

import { validateLineup, validateRoster } from './roster'
import type { Lineup, Team, TeamPlayer } from './types'

const teams: Team[] = [
  { id: 'a1', name: 'A1', group: 'A' },
  { id: 'a2', name: 'A2', group: 'A' },
  { id: 'b1', name: 'B1', group: 'B' },
  { id: 'b2', name: 'B2', group: 'B' },
]

const players: TeamPlayer[] = teams.flatMap((team) => [
  { id: `${team.id}-s1a`, name: 'Seed 1 A', seed: 1, teamId: team.id },
  { id: `${team.id}-s1b`, name: 'Seed 1 B', seed: 1, teamId: team.id },
  { id: `${team.id}-s2a`, name: 'Seed 2 A', seed: 2, teamId: team.id },
  { id: `${team.id}-s2b`, name: 'Seed 2 B', seed: 2, teamId: team.id },
])

const validLineup: Lineup = {
  fixtureId: 'fixture-a',
  teamId: 'a1',
  pairs: [
    { seed1PlayerId: 'a1-s1a', seed2PlayerId: 'a1-s2a' },
    { seed1PlayerId: 'a1-s1b', seed2PlayerId: 'a1-s2b' },
    { seed1PlayerId: 'a1-s1a', seed2PlayerId: 'a1-s2b' },
  ],
  confirmedAt: null,
}

describe('validateRoster', () => {
  it('accepts four teams of four distinct players with balanced groups and seeds', () => {
    expect(validateRoster(teams, players)).toEqual([])
  })

  it('reports invalid team, player, seed, membership, and group counts', () => {
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
        'group-split',
      ]),
    )
  })
})

describe('validateLineup', () => {
  it('accepts disjoint openers covering the roster and a recombined decider', () => {
    expect(validateLineup(validLineup, players)).toEqual([])
  })

  it('rejects repeated opening players and an opening pair reused as the decider', () => {
    const lineup: Lineup = {
      ...validLineup,
      pairs: [validLineup.pairs[0], validLineup.pairs[0], validLineup.pairs[0]],
    }

    expect(validateLineup(lineup, players).map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'opening-player-repeated',
        'opening-players-incomplete',
        'decider-repeats-opening-pair',
      ]),
    )
  })

  it('rejects unknown, other-team, and incorrectly seeded players', () => {
    const lineup: Lineup = {
      ...validLineup,
      pairs: [
        { seed1PlayerId: 'missing', seed2PlayerId: 'a1-s1a' },
        { seed1PlayerId: 'b1-s1a', seed2PlayerId: 'a1-s2b' },
        validLineup.pairs[2],
      ],
    }

    expect(validateLineup(lineup, players).map(({ code }) => code)).toEqual(
      expect.arrayContaining(['unknown-player', 'wrong-team', 'wrong-seed']),
    )
  })
})
