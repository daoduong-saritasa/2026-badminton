import { describe, expect, it } from 'vitest'

import { validateLineup, validateQualifyingRotation, validateRoster } from './roster'
import type { Lineup, LineupPair, Team, TeamPlayer } from './types'

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

function pair(player1Id: string, player2Id: string): LineupPair {
  return { player1Id, player2Id }
}

const validLineup: Lineup = {
  fixtureId: 'fixture-a',
  teamId: 't1',
  pairs: [
    pair('t1-s1a', 't1-s2a'),
    pair('t1-s1b', 't1-s2b'),
    pair('t1-s1a', 't1-s2b'),
    pair('t1-s1a', 't1-s1b'),
  ],
  confirmedAt: null,
}

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

describe('validateLineup', () => {
  it('accepts disjoint openers covering the roster, a recombined decider, and a same-seed playoff pair', () => {
    expect(validateLineup(validLineup, players)).toEqual([])
  })

  it('rejects repeated opening players and an opening pair reused as the decider in either order', () => {
    const lineup: Lineup = {
      ...validLineup,
      pairs: [
        validLineup.pairs[0],
        validLineup.pairs[0],
        pair('t1-s2a', 't1-s1a'),
        validLineup.pairs[3],
      ],
    }

    expect(validateLineup(lineup, players).map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'opening-player-repeated',
        'opening-players-incomplete',
        'decider-repeats-opening-pair',
      ]),
    )
  })

  it('rejects unknown and other-team players', () => {
    const lineup: Lineup = {
      ...validLineup,
      pairs: [
        pair('missing', 't1-s2a'),
        pair('t2-s1a', 't1-s2b'),
        validLineup.pairs[2],
        validLineup.pairs[3],
      ],
    }

    expect(validateLineup(lineup, players).map(({ code }) => code)).toEqual(
      expect.arrayContaining(['unknown-player', 'wrong-team']),
    )
  })

  it('rejects a same-seed pair in matches 1–3', () => {
    const lineup: Lineup = {
      ...validLineup,
      pairs: [
        pair('t1-s1a', 't1-s1b'),
        pair('t1-s2a', 't1-s2b'),
        pair('t1-s1a', 't1-s2b'),
        validLineup.pairs[3],
      ],
    }

    expect(validateLineup(lineup, players)).toEqual([
      { code: 'same-seed-pair', matchNumber: 1 },
      { code: 'same-seed-pair', matchNumber: 2 },
    ])
  })

  it('rejects the same player twice in a pair, including the playoff pair', () => {
    const lineup: Lineup = {
      ...validLineup,
      pairs: [...validLineup.pairs.slice(0, 3), pair('t1-s2a', 't1-s2a')] as Lineup['pairs'],
    }

    expect(validateLineup(lineup, players)).toEqual([
      { code: 'pair-player-repeated', matchNumber: 4, playerId: 't1-s2a' },
    ])
  })
})

describe('validateQualifyingRotation', () => {
  const straight: Lineup = validLineup
  const crossed: Lineup = {
    ...validLineup,
    fixtureId: 'fixture-b',
    pairs: [
      pair('t1-s2b', 't1-s1a'),
      pair('t1-s1b', 't1-s2a'),
      pair('t1-s1a', 't1-s2a'),
      validLineup.pairs[3],
    ],
  }

  it('accepts a team that uses both mixed-seed arrangements across its fixtures', () => {
    const lineups = [straight, crossed, { ...straight, fixtureId: 'fixture-c' }]

    expect(validateQualifyingRotation(lineups, players)).toEqual([])
  })

  it('reports a team that repeats one arrangement in every fixture', () => {
    const lineups = [
      straight,
      { ...straight, fixtureId: 'fixture-b' },
      { ...straight, fixtureId: 'fixture-c' },
    ]

    expect(validateQualifyingRotation(lineups, players)).toEqual([
      { code: 'rotation-incomplete', teamId: 't1' },
    ])
  })
})
