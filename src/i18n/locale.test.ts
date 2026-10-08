import { afterEach, describe, expect, it } from 'vitest'

import { errorMessage } from './errors'
import { formatNumber } from './format'
import { currentLocale, setLocale } from './locale'
import { messages } from './messages'

describe('setLocale', () => {
  afterEach(() => setLocale('vi'))

  it('starts in Vietnamese', () => {
    expect(currentLocale()).toBe('vi')
    expect(messages.app.tabs.matches).toBe('Trận đấu')
  })

  it('switches copy, numbers, and server errors to English', () => {
    setLocale('en')
    expect(messages.app.tabs.matches).toBe('Matches')
    expect(messages.fixtures.position(2)).toBe('2nd place')
    expect(formatNumber(1234.5)).toBe('1,234.5')
    expect(errorMessage(new Error('Court is occupied'))).toBe('Another match is in play on this court.')
  })

  it('returns to Vietnamese', () => {
    setLocale('en')
    setLocale('vi')
    expect(messages.common.matchNumber(3)).toBe('Trận 3')
    expect(formatNumber(1000)).toBe('1.000')
  })
})
