import { describe, expect, it } from 'vitest'

import { formatNumber } from './format'

describe('formatNumber', () => {
  it('formats scores and small counts unchanged', () => {
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(21)).toBe('21')
    expect(formatNumber(30)).toBe('30')
  })

  it('groups thousands the Vietnamese way', () => {
    expect(formatNumber(1000)).toBe('1.000')
    expect(formatNumber(1234567)).toBe('1.234.567')
  })

  it('uses a comma for a decimal separator', () => {
    expect(formatNumber(1.5)).toBe('1,5')
  })

  it('formats negative point differences', () => {
    expect(formatNumber(-7)).toBe('-7')
  })

  it('renders a dash rather than NaN or Infinity', () => {
    expect(formatNumber(Number.NaN)).toBe('—')
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('—')
  })
})
