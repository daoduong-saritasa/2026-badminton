import { describe, expect, it } from 'vitest'

import { generateFixtures } from './fixtures'
import type { CourtCount, Fixture, Group, GroupFixture, Pair, UUID } from './types'

const TOTAL_MATCHES = new Map([
  [4, 5],
  [5, 7],
  [6, 9],
  [7, 12],
  [8, 15],
  [9, 19],
  [10, 23],
])

function makePairs(count: number, largerGroup: Group = 'A'): Pair[] {
  const smallerSize = Math.floor(count / 2)
  const groupASize = count % 2 === 0 || largerGroup === 'A' ? count - smallerSize : smallerSize

  return Array.from({ length: count }, (_, index) => ({
    id: `pair-${index + 1}`,
    teamName: null,
    playerAId: `player-${index * 2 + 1}`,
    playerBId: `player-${index * 2 + 2}`,
    group: index < groupASize ? 'A' : 'B',
    withdrawn: false,
  }))
}

function groupFixtures(fixtures: readonly Fixture[]): GroupFixture[] {
  return fixtures.filter((fixture): fixture is GroupFixture => fixture.round === 'group')
}

function fixtureKey(fixture: GroupFixture): string {
  return [fixture.pairAId, fixture.pairBId].sort().join(':')
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

function isRested(fixture: GroupFixture, previousPairIds: ReadonlySet<UUID>): boolean {
  return !previousPairIds.has(fixture.pairAId) && !previousPairIds.has(fixture.pairBId)
}

function areDisjoint(first: GroupFixture, second: GroupFixture): boolean {
  const firstPairIds = new Set([first.pairAId, first.pairBId])
  return !firstPairIds.has(second.pairAId) && !firstPairIds.has(second.pairBId)
}

function bestAvailableSlot(
  remaining: readonly GroupFixture[],
  previousPairIds: ReadonlySet<UUID>,
  courtCount: CourtCount,
): { size: number; restedMatches: number } {
  let best = { size: 0, restedMatches: 0 }

  const consider = (fixtures: readonly GroupFixture[]): void => {
    const candidate = {
      size: fixtures.length,
      restedMatches: fixtures.filter((fixture) => isRested(fixture, previousPairIds)).length,
    }
    if (candidate.size > best.size || (candidate.size === best.size && candidate.restedMatches > best.restedMatches)) {
      best = candidate
    }
  }

  for (let first = 0; first < remaining.length; first += 1) {
    const firstFixture = remaining[first]
    if (!firstFixture) continue
    consider([firstFixture])

    for (let second = first + 1; courtCount === 2 && second < remaining.length; second += 1) {
      const secondFixture = remaining[second]
      if (secondFixture && areDisjoint(firstFixture, secondFixture)) consider([firstFixture, secondFixture])
    }
  }

  return best
}

describe.each([1, 2] as const)('generateFixtures on %i court(s)', (courtCount) => {
  describe.each([4, 5, 6, 7, 8, 9, 10] as const)('with %i pairs', (count) => {
    const orientations: Group[] = count % 2 === 0 ? ['A'] : ['A', 'B']

    it.each(orientations)('supports Group %s as the larger group', (largerGroup) => {
      const pairs = makePairs(count, largerGroup)
      const fixtures = generateFixtures(pairs, courtCount)
      const groups = groupFixtures(fixtures)

      expect(fixtures).toHaveLength(TOTAL_MATCHES.get(count))
      for (const group of ['A', 'B'] as const) {
        expect(groups.filter((fixture) => fixture.group === group).map(fixtureKey).sort()).toEqual(
          expectedPairings(pairs, group),
        )
      }

      expect(new Set(groups.map((fixture) => `${fixture.court}:${fixture.playingOrder}`)).size).toBe(groups.length)
      expect(groups.every((fixture) => fixture.court <= courtCount)).toBe(true)

      const orders = [...new Set(groups.map((fixture) => fixture.playingOrder))].toSorted((a, b) => a - b)
      let remaining = [...groups]
      let previousPairs = new Set<UUID>()

      for (const order of orders) {
        const current = groups.filter((fixture) => fixture.playingOrder === order)
        const best = bestAvailableSlot(remaining, previousPairs, courtCount)
        expect(current).toHaveLength(best.size)
        expect(current.filter((fixture) => isRested(fixture, previousPairs))).toHaveLength(best.restedMatches)

        const currentKeys = new Set(current.map(fixtureKey))
        remaining = remaining.filter((fixture) => !currentKeys.has(fixtureKey(fixture)))
        previousPairs = new Set(current.flatMap((fixture) => [fixture.pairAId, fixture.pairBId]))
      }
    })
  })

  it('orders semifinals before the final', () => {
    const knockouts = generateFixtures(makePairs(8), courtCount).filter((fixture) => fixture.round !== 'group')
    const [first, second, final] = knockouts

    expect(knockouts.map((fixture) => fixture.round)).toEqual(['semifinal', 'semifinal', 'final'])
    expect(first).toMatchObject({ sourceALabel: 'A1', sourceBLabel: 'B2', court: 1 })
    expect(second).toMatchObject({ sourceALabel: 'B1', sourceBLabel: 'A2', court: courtCount === 2 ? 2 : 1 })
    expect(final).toMatchObject({ sourceALabel: 'SF1 winner', sourceBLabel: 'SF2 winner', court: 1 })
    expect(final?.playingOrder).toBeGreaterThan(second?.playingOrder ?? 0)
  })
})

describe('fixture validation', () => {
  it('rejects unsupported pair counts, duplicate identifiers, and invalid splits', () => {
    expect(() => generateFixtures(makePairs(4).slice(0, 3), 2)).toThrow('Fixtures require 4 to 10 pairs')
    expect(() => generateFixtures([...makePairs(10), makePairs(4)[0] as Pair], 2)).toThrow('Fixtures require 4 to 10 pairs')

    const duplicates = makePairs(4)
    duplicates[3] = { ...duplicates[3] as Pair, id: duplicates[0]?.id ?? '' }
    expect(() => generateFixtures(duplicates, 2)).toThrow('Pair identifiers must be unique')

    const unbalanced = makePairs(6)
    unbalanced[4] = { ...unbalanced[4] as Pair, group: 'A' }
    expect(() => generateFixtures(unbalanced, 2)).toThrow('Groups must be balanced')
  })
})
