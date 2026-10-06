import { describe, expect, it } from 'vitest'

import { courtNameIssues } from './courts'

describe('courtNameIssues', () => {
  it('accepts two distinct names', () => {
    expect(courtNameIssues(['Sân A', 'Sân trung tâm'])).toEqual([])
  })

  it('rejects a blank name, counting only whitespace as blank', () => {
    expect(courtNameIssues(['  ', 'Sân 2'])).toEqual(['empty'])
  })

  it('rejects a name longer than 30 characters after trimming', () => {
    expect(courtNameIssues([`  ${'a'.repeat(30)}  `, 'Sân 2'])).toEqual([])
    expect(courtNameIssues(['a'.repeat(31), 'Sân 2'])).toEqual(['too-long'])
  })

  it('rejects the same name twice, ignoring case and outer spaces', () => {
    expect(courtNameIssues(['Sân A', ' sân a '])).toEqual(['duplicate'])
  })
})
