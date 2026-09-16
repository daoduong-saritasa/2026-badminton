import { describe, expect, it } from 'vitest'

import { tournamentTitle } from './document-title'

describe('tournamentTitle', () => {
  it('falls back to the generic identity without a tournament', () => {
    expect(tournamentTitle(null)).toBe('Giải cầu lông')
  })

  it('falls back when the name is blank', () => {
    expect(tournamentTitle('   ')).toBe('Giải cầu lông')
  })

  it('uses the configured name as entered', () => {
    expect(tournamentTitle('  Cúp Mùa Thu 2026 ')).toBe('Cúp Mùa Thu 2026')
  })
})
