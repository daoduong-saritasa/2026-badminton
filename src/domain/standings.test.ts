import { describe, expect, it } from 'vitest'

import { calculateStandings } from './standings'
import type {
  CompletedPlayedMatch,
  CompletedWalkoverMatch,
  Match,
  Pair,
  Score,
  TournamentSnapshot,
  UUID,
} from './types'

function makePair(id: UUID, withdrawn = false): Pair {
  return {
    id,
    teamName: null,
    playerAId: `${id}-player-a`,
    playerBId: `${id}-player-b`,
    group: 'A',
    withdrawn,
  }
}

function matchBase(id: UUID, pairAId: UUID, pairBId: UUID) {
  return {
    id,
    round: 'group' as const,
    group: 'A' as const,
    pairAId,
    pairBId,
    sourceALabel: null,
    sourceBLabel: null,
    sourceAMatchId: null,
    sourceBMatchId: null,
    court: 1 as const,
    playingOrder: 1,
    version: 1,
  }
}

function playedMatch(
  id: UUID,
  pairAId: UUID,
  pairBId: UUID,
  score: Score,
): CompletedPlayedMatch {
  return {
    ...matchBase(id, pairAId, pairBId),
    state: 'completed',
    score,
    resultKind: 'played',
    winnerId: score.a > score.b ? pairAId : pairBId,
  }
}

function walkover(
  id: UUID,
  pairAId: UUID,
  pairBId: UUID,
  winnerId: UUID,
): CompletedWalkoverMatch {
  return {
    ...matchBase(id, pairAId, pairBId),
    state: 'completed',
    score: null,
    resultKind: 'walkover',
    winnerId,
  }
}

function snapshot(
  pairs: Pair[],
  matches: Match[],
  tieResolutions: TournamentSnapshot['tieResolutions'] = [],
): TournamentSnapshot {
  return {
    tournament: {
      id: 'tournament',
      name: 'Badminton Tournament 2026',
      stage: 'groups',
      setupLockedAt: null,
      version: 1,
    },
    players: [],
    pairs,
    matches,
    tieResolutions,
  }
}

describe('calculateStandings', () => {
  it('uses only confirmed results for wins and points', () => {
    const pairs = [makePair('a'), makePair('b')]
    const playing: Match = {
      ...matchBase('playing', 'a', 'b'),
      state: 'playing',
      score: { a: 20, b: 0 },
      resultKind: null,
      winnerId: null,
    }

    const standings = calculateStandings(
      snapshot(pairs, [playing, playedMatch('confirmed', 'a', 'b', { a: 21, b: 19 })]),
      'A',
    )

    expect(standings).toEqual([
      expect.objectContaining({ pairId: 'a', wins: 1, pointsFor: 21, rank: 1 }),
      expect.objectContaining({ pairId: 'b', losses: 1, pointsFor: 19, rank: 2 }),
    ])
  })

  it('uses head-to-head for each two-pair wins tie', () => {
    const pairs = ['a', 'b', 'c', 'd'].map((id) => makePair(id))
    const standings = calculateStandings(
      snapshot(pairs, [
        playedMatch('ab', 'a', 'b', { a: 21, b: 19 }),
        playedMatch('ca', 'c', 'a', { a: 21, b: 19 }),
        playedMatch('da', 'd', 'a', { a: 21, b: 19 }),
        playedMatch('bc', 'b', 'c', { a: 21, b: 19 }),
        playedMatch('db', 'd', 'b', { a: 21, b: 19 }),
        playedMatch('cd', 'c', 'd', { a: 21, b: 19 }),
      ]),
      'A',
    )

    expect(standings.map(({ pairId, rank, tieStatus }) => ({ pairId, rank, tieStatus })))
      .toEqual([
        { pairId: 'c', rank: 1, tieStatus: 'head-to-head' },
        { pairId: 'd', rank: 2, tieStatus: 'head-to-head' },
        { pairId: 'a', rank: 3, tieStatus: 'head-to-head' },
        { pairId: 'b', rank: 4, tieStatus: 'head-to-head' },
      ])
  })

  it('uses tied-pair point difference for a three-pair tie', () => {
    const pairs = ['a', 'b', 'c'].map((id) => makePair(id))
    const standings = calculateStandings(
      snapshot(pairs, [
        playedMatch('ab', 'a', 'b', { a: 21, b: 10 }),
        playedMatch('bc', 'b', 'c', { a: 21, b: 18 }),
        playedMatch('ca', 'c', 'a', { a: 21, b: 19 }),
      ]),
      'A',
    )

    expect(standings.map(({ pairId, pointDifference, rank }) => ({ pairId, pointDifference, rank })))
      .toEqual([
        { pairId: 'a', pointDifference: 9, rank: 1 },
        { pairId: 'c', pointDifference: -1, rank: 2 },
        { pairId: 'b', pointDifference: -8, rank: 3 },
      ])
  })

  it('leaves a residual mini-table tie for manual ordering', () => {
    const pairs = ['a', 'b', 'c'].map((id) => makePair(id))
    const matches = [
      playedMatch('ab', 'a', 'b', { a: 21, b: 19 }),
      playedMatch('bc', 'b', 'c', { a: 21, b: 19 }),
      playedMatch('ca', 'c', 'a', { a: 21, b: 19 }),
    ]

    const unresolved = calculateStandings(snapshot(pairs, matches), 'A')
    const resolved = calculateStandings(
      snapshot(pairs, matches, [
        {
          group: 'A',
          orderedPairIds: ['c', 'a', 'b'],
          explanation: 'Organizer decision',
          standingsRevision: 1,
        },
      ]),
      'A',
    )

    expect(unresolved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pairId: 'a', rank: null, tieStatus: 'manual' }),
        expect.objectContaining({ pairId: 'b', rank: null, tieStatus: 'manual' }),
        expect.objectContaining({ pairId: 'c', rank: null, tieStatus: 'manual' }),
      ]),
    )
    expect(resolved.map(({ pairId, rank }) => ({ pairId, rank }))).toEqual([
      { pairId: 'c', rank: 1 },
      { pairId: 'a', rank: 2 },
      { pairId: 'b', rank: 3 },
    ])
  })

  it('counts a walkover win without fabricating points', () => {
    const standings = calculateStandings(
      snapshot([makePair('a'), makePair('b')], [walkover('ab', 'a', 'b', 'a')]),
      'A',
    )

    expect(standings).toEqual([
      expect.objectContaining({
        pairId: 'a',
        played: 1,
        wins: 1,
        pointsFor: 0,
        pointsAgainst: 0,
      }),
      expect.objectContaining({
        pairId: 'b',
        played: 1,
        losses: 1,
        pointsFor: 0,
        pointsAgainst: 0,
      }),
    ])
  })

  it('excludes withdrawn pairs and voids their group results', () => {
    const standings = calculateStandings(
      snapshot(
        [makePair('a'), makePair('b'), makePair('c', true)],
        [
          playedMatch('ac', 'a', 'c', { a: 21, b: 0 }),
          playedMatch('ab', 'a', 'b', { a: 21, b: 19 }),
        ],
      ),
      'A',
    )

    expect(standings.map((standing) => standing.pairId)).toEqual(['a', 'b'])
    expect(standings[0]).toEqual(
      expect.objectContaining({ played: 1, wins: 1, pointsFor: 21 }),
    )
  })
})
