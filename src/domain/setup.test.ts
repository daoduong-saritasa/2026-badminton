import { describe, expect, it } from 'vitest'

import { availableCourts, isValidGroupSplit } from './setup'
import type { Group } from './types'

function groups(...groups: Group[]): { group: Group }[] {
  return groups.map((group) => ({ group }))
}

describe('isValidGroupSplit', () => {
  it.each([
    [groups('A', 'A', 'B', 'B')],
    [groups('A', 'A', 'A', 'B', 'B')],
    [groups('A', 'A', 'B', 'B', 'B')],
    [groups('A', 'A', 'A', 'B', 'B', 'B')],
    [groups('A', 'A', 'A', 'A', 'B', 'B', 'B')],
    [groups('A', 'A', 'A', 'B', 'B', 'B', 'B')],
    [groups('A', 'A', 'A', 'A', 'B', 'B', 'B', 'B')],
    [groups('A', 'A', 'A', 'A', 'A', 'B', 'B', 'B', 'B')],
    [groups('A', 'A', 'A', 'A', 'B', 'B', 'B', 'B', 'B')],
    [groups('A', 'A', 'A', 'A', 'A', 'B', 'B', 'B', 'B', 'B')],
  ])('accepts a required balanced split', (pairs) => {
    expect(isValidGroupSplit(pairs)).toBe(true)
  })

  it.each([
    [groups('A', 'A', 'B')],
    [groups('A', 'A', 'A', 'A', 'A', 'B', 'B', 'B', 'B', 'B', 'B')],
    [groups('A', 'A', 'A', 'B')],
    [groups('A', 'A', 'A', 'A', 'B', 'B')],
  ])('rejects an out-of-range or unbalanced split', (pairs) => {
    expect(isValidGroupSplit(pairs)).toBe(false)
  })
})

describe('availableCourts', () => {
  it('requires an explicit court choice', () => {
    expect(availableCourts(null)).toEqual([])
  })

  it('returns only configured courts', () => {
    expect(availableCourts(1)).toEqual([1])
    expect(availableCourts(2)).toEqual([1, 2])
  })
})
