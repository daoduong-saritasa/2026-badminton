import type {
  Court,
  Fixture,
  Group,
  GroupFixture,
  Pair,
  UUID,
} from './types'

interface Pairing {
  group: Group
  pairAId: UUID
  pairBId: UUID
}

const EXPECTED_GROUP_SIZES: Readonly<Record<number, readonly [number, number]>> = {
  6: [3, 3],
  7: [4, 3],
  8: [4, 4],
}

function createPairings(pairs: readonly Pair[], group: Group): Pairing[] {
  const groupPairs = pairs.filter((pair) => pair.group === group)
  const pairings: Pairing[] = []

  for (let first = 0; first < groupPairs.length; first += 1) {
    for (let second = first + 1; second < groupPairs.length; second += 1) {
      const pairA = groupPairs[first]
      const pairB = groupPairs[second]

      if (pairA && pairB) {
        pairings.push({ group, pairAId: pairA.id, pairBId: pairB.id })
      }
    }
  }

  return pairings
}

function participants(pairing: Pairing): readonly [UUID, UUID] {
  return [pairing.pairAId, pairing.pairBId]
}

function overlaps(pairing: Pairing, pairIds: ReadonlySet<UUID>): boolean {
  return participants(pairing).some((pairId) => pairIds.has(pairId))
}

function areDisjoint(first: Pairing, second: Pairing): boolean {
  return !overlaps(second, new Set(participants(first)))
}

function chooseNextSlot(
  remaining: readonly Pairing[],
  previousPairIds: ReadonlySet<UUID>,
): number[] {
  let bestIndices: number[] = []
  let bestScore = Number.NEGATIVE_INFINITY

  const consider = (indices: number[]): void => {
    const restedMatches = indices.filter(
      (index) => !overlaps(remaining[index] as Pairing, previousPairIds),
    ).length
    const score = indices.length * 100 + restedMatches

    if (score > bestScore) {
      bestIndices = indices
      bestScore = score
    }
  }

  for (let first = 0; first < remaining.length; first += 1) {
    consider([first])

    for (let second = first + 1; second < remaining.length; second += 1) {
      const firstPairing = remaining[first]
      const secondPairing = remaining[second]

      if (firstPairing && secondPairing && areDisjoint(firstPairing, secondPairing)) {
        consider([first, second])
      }
    }
  }

  return bestIndices
}

function validatePairs(pairs: readonly Pair[]): void {
  const expectedSizes = EXPECTED_GROUP_SIZES[pairs.length]

  if (!expectedSizes) {
    throw new Error('Fixtures require 6, 7, or 8 pairs')
  }

  if (new Set(pairs.map((pair) => pair.id)).size !== pairs.length) {
    throw new Error('Pair identifiers must be unique')
  }

  const groupASize = pairs.filter((pair) => pair.group === 'A').length
  const groupBSize = pairs.filter((pair) => pair.group === 'B').length

  if (groupASize !== expectedSizes[0] || groupBSize !== expectedSizes[1]) {
    throw new Error(
      `Expected group sizes ${expectedSizes[0]}+${expectedSizes[1]} for ${pairs.length} pairs`,
    )
  }
}

export function generateFixtures(pairs: readonly Pair[]): Fixture[] {
  validatePairs(pairs)

  const remaining = [
    ...createPairings(pairs, 'A'),
    ...createPairings(pairs, 'B'),
  ]
  const groupFixtures: GroupFixture[] = []
  let previousPairIds = new Set<UUID>()
  let playingOrder = 1

  while (remaining.length > 0) {
    const selectedIndices = chooseNextSlot(remaining, previousPairIds)
    const selected = selectedIndices.map((index) => remaining[index] as Pairing)

    selected.forEach((pairing, courtIndex) => {
      groupFixtures.push({
        round: 'group',
        group: pairing.group,
        pairAId: pairing.pairAId,
        pairBId: pairing.pairBId,
        sourceALabel: null,
        sourceBLabel: null,
        court: (courtIndex + 1) as Court,
        playingOrder,
      })
    })

    previousPairIds = new Set(selected.flatMap((pairing) => participants(pairing)))

    for (const index of selectedIndices.toSorted((a, b) => b - a)) {
      remaining.splice(index, 1)
    }

    playingOrder += 1
  }

  return [
    ...groupFixtures,
    {
      round: 'semifinal',
      group: null,
      pairAId: null,
      pairBId: null,
      sourceALabel: 'A1',
      sourceBLabel: 'B2',
      court: 1,
      playingOrder,
    },
    {
      round: 'semifinal',
      group: null,
      pairAId: null,
      pairBId: null,
      sourceALabel: 'B1',
      sourceBLabel: 'A2',
      court: 2,
      playingOrder,
    },
    {
      round: 'final',
      group: null,
      pairAId: null,
      pairBId: null,
      sourceALabel: 'SF1 winner',
      sourceBLabel: 'SF2 winner',
      court: 1,
      playingOrder: playingOrder + 1,
    },
  ]
}
