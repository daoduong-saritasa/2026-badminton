import type { Court, CourtCount, Pair } from './types'

export function isValidGroupSplit(
  pairs: readonly Pick<Pair, 'group'>[],
): boolean {
  if (pairs.length < 4 || pairs.length > 10) {
    return false
  }

  const groupACount = pairs.filter((pair) => pair.group === 'A').length
  const groupBCount = pairs.length - groupACount

  return Math.abs(groupACount - groupBCount) <= 1
}

export function availableCourts(
  courtCount: CourtCount | null,
): readonly Court[] {
  if (courtCount === null) {
    return []
  }

  return courtCount === 1 ? [1] : [1, 2]
}
