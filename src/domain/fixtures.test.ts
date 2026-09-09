import { describe, expect, it } from 'vitest'

import { generateFixtures } from './fixtures'
import type { Fixture, Group, GroupFixture, Pair, UUID } from './types'

function makePairs(count: 6 | 7 | 8): Pair[] {
  const groupASize = count === 6 ? 3 : 4

  return Array.from({ length: count }, (_, index) => ({
    id: `pair-${index + 1}`,
    teamName: null,
    playerAId: `player-${index * 2 + 1}`,
    playerBId: `player-${index * 2 + 2}`,
    group: index < groupASize ? 'A' : 'B',
    withdrawn: false,
  }))
}

function groupFixtures(fixtures: readonly Fixture[]) {
  return fixtures.filter((fixture) => fixture.round === 'group')
}

function groupByOrder(fixtures: readonly GroupFixture[]): Map<number, GroupFixture[]> {
  const byOrder = new Map<number, GroupFixture[]>()

  for (const fixture of fixtures) {
    const slot = byOrder.get(fixture.playingOrder) ?? []
    slot.push(fixture)
    byOrder.set(fixture.playingOrder, slot)
  }

  return byOrder
}

function fixtureKey(fixture: GroupFixture): string {
  return [fixture.pairAId, fixture.pairBId].sort().join(':')
}

function isRested(fixture: GroupFixture, previousPairIds: ReadonlySet<UUID>): boolean {
  return (
    !previousPairIds.has(fixture.pairAId) &&
    !previousPairIds.has(fixture.pairBId)
  )
}

function areDisjoint(first: GroupFixture, second: GroupFixture): boolean {
  const firstPairIds = new Set([first.pairAId, first.pairBId])
  return !firstPairIds.has(second.pairAId) && !firstPairIds.has(second.pairBId)
}

function bestAvailableSlot(
  remaining: readonly GroupFixture[],
  previousPairIds: ReadonlySet<UUID>,
): { size: number; restedMatches: number } {
  let best = { size: 0, restedMatches: 0 }

  const consider = (fixtures: readonly GroupFixture[]): void => {
    const candidate = {
      size: fixtures.length,
      restedMatches: fixtures.filter((fixture) => isRested(fixture, previousPairIds))
        .length,
    }

    if (
      candidate.size > best.size ||
      (candidate.size === best.size && candidate.restedMatches > best.restedMatches)
    ) {
      best = candidate
    }
  }

  for (let first = 0; first < remaining.length; first += 1) {
    const firstFixture = remaining[first]

    if (!firstFixture) {
      continue
    }

    consider([firstFixture])

    for (let second = first + 1; second < remaining.length; second += 1) {
      const secondFixture = remaining[second]

      if (secondFixture && areDisjoint(firstFixture, secondFixture)) {
        consider([firstFixture, secondFixture])
      }
    }
  }

  return best
}

function expectedPairings(pairs: readonly Pair[], group: Group): string[] {
  const ids = pairs.filter((pair) => pair.group === group).map((pair) => pair.id)
  const pairings: string[] = []

  for (let first = 0; first < ids.length; first += 1) {
    for (let second = first + 1; second < ids.length; second += 1) {
      pairings.push([ids[first], ids[second]].sort().join(':'))
    }
  }

  return pairings.sort()
}

describe.each([6, 7, 8] as const)('generateFixtures with %i pairs', (count) => {
  const pairs = makePairs(count)
  const fixtures = generateFixtures(pairs)
  const groups = groupFixtures(fixtures)

  it(`creates ${count === 6 ? 9 : count === 7 ? 12 : 15} total matches`, () => {
    expect(fixtures).toHaveLength(count === 6 ? 9 : count === 7 ? 12 : 15)
  })

  it.each(['A', 'B'] as const)(
    'plays every Group %s pairing exactly once within the group',
    (group) => {
      const actual = groups
        .filter((fixture) => fixture.group === group)
        .map((fixture) => [fixture.pairAId, fixture.pairBId].sort().join(':'))
        .sort()

      expect(actual).toEqual(expectedPairings(pairs, group))
    },
  )

  it('uses both courts without scheduling a pair twice in one slot', () => {
    const byOrder = groupByOrder(groups)

    expect(groups.some((fixture) => fixture.court === 1)).toBe(true)
    expect(groups.some((fixture) => fixture.court === 2)).toBe(true)

    for (const slot of byOrder.values()) {
      expect(new Set(slot.map((fixture) => fixture.court)).size).toBe(slot.length)
      expect(slot.length).toBeLessThanOrEqual(2)

      const pairIds = slot.flatMap((fixture) => [fixture.pairAId, fixture.pairBId])
      expect(new Set(pairIds).size).toBe(pairIds.length)
    }
  })

  it('avoids consecutive play whenever another full court slot is available', () => {
    const byOrder = groupByOrder(groups)
    const orders = [...byOrder.keys()].toSorted((a, b) => a - b)
    let remaining = [...groups]
    let previousPairs = new Set<UUID>()

    for (const order of orders) {
      const current = byOrder.get(order) ?? []
      const best = bestAvailableSlot(remaining, previousPairs)

      expect(current).toHaveLength(best.size)
      expect(current.filter((fixture) => isRested(fixture, previousPairs))).toHaveLength(
        best.restedMatches,
      )

      const currentKeys = new Set(current.map(fixtureKey))
      remaining = remaining.filter((fixture) => !currentKeys.has(fixtureKey(fixture)))
      previousPairs = new Set(
        current.flatMap((fixture) => [fixture.pairAId, fixture.pairBId]),
      )
    }
  })
})

describe('knockout slots', () => {
  it('leaves two semifinals and the final unresolved with dependency labels', () => {
    const fixtures = generateFixtures(makePairs(8))
    const knockouts = fixtures.filter((fixture) => fixture.round !== 'group')

    expect(knockouts).toEqual([
      expect.objectContaining({
        round: 'semifinal',
        pairAId: null,
        pairBId: null,
        sourceALabel: 'A1',
        sourceBLabel: 'B2',
      }),
      expect.objectContaining({
        round: 'semifinal',
        pairAId: null,
        pairBId: null,
        sourceALabel: 'B1',
        sourceBLabel: 'A2',
      }),
      expect.objectContaining({
        round: 'final',
        pairAId: null,
        pairBId: null,
        sourceALabel: 'SF1 winner',
        sourceBLabel: 'SF2 winner',
      }),
    ])
  })
})

describe('fixture validation', () => {
  it('rejects unsupported pair counts and invalid group sizes', () => {
    expect(() => generateFixtures(makePairs(6).slice(0, 5))).toThrow(
      'Fixtures require 6, 7, or 8 pairs',
    )

    const pairs = makePairs(7)
    const lastPair = pairs[6]

    if (lastPair) {
      lastPair.group = 'A'
    }

    expect(() => generateFixtures(pairs)).toThrow('Expected group sizes 4+3')
  })
})
