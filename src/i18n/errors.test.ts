import { describe, expect, it, vi } from 'vitest'

import { errorMessage, unknownErrorMessage } from './errors'

describe('errorMessage', () => {
  it('translates a known server failure', () => {
    expect(errorMessage(new Error('Tournament version conflict')))
      .toBe('Giải đấu vừa thay đổi. Hãy tải lại và thử lại.')
  })

  it('distinguishes a withdrawal block from a walkover instruction', () => {
    expect(errorMessage(new Error('Pair cannot withdraw after knockout play starts')))
      .toContain('xử thắng')
    expect(errorMessage(new Error('Each group must retain at least two active pairs')))
      .toBe('Mỗi bảng phải còn ít nhất hai đội thi đấu.')
  })

  it('states that a same-winner group correction is also blocked', () => {
    expect(errorMessage(new Error('Knockout play already depends on group participants')))
      .toContain('kể cả khi đội thắng không đổi')
  })

  it('accepts a plain string and a PostgREST-shaped object', () => {
    expect(errorMessage('Match not found')).toBe('Không tìm thấy trận đấu.')
    expect(errorMessage({ message: 'Match not found' })).toBe('Không tìm thấy trận đấu.')
  })

  it('tolerates surrounding whitespace', () => {
    expect(errorMessage(new Error('  Match not found  '))).toBe('Không tìm thấy trận đấu.')
  })

  it('translates client-side failures by name, not by text', () => {
    const invalid = new Error('The server returned an invalid tournament state')
    invalid.name = 'InvalidTournamentDataError'
    expect(errorMessage(invalid)).toBe('Dữ liệu nhận được không hợp lệ. Hãy tải lại trang.')

    const stale = new Error('Received tournament version 3; expected at least 5')
    stale.name = 'StaleTournamentSnapshotError'
    expect(errorMessage(stale)).toBe('Dữ liệu đang cũ hơn thay đổi vừa lưu. Hãy tải lại trang.')
  })

  it('never exposes raw server text for an unknown failure', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const raw = 'relation "public.tournament_42" does not exist'

    expect(errorMessage(new Error(raw))).toBe(unknownErrorMessage)
    expect(errorMessage(new Error(raw))).not.toContain('tournament_42')
    expect(logged).toHaveBeenCalled()

    logged.mockRestore()
  })

  it('falls back when there is no message at all', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(errorMessage(null)).toBe(unknownErrorMessage)
    expect(errorMessage(undefined)).toBe(unknownErrorMessage)
    expect(errorMessage({ code: 42 })).toBe(unknownErrorMessage)

    logged.mockRestore()
  })

  it('returns Vietnamese for every catalogued message', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const asciiOnly = /^[\x20-\x7E]*$/

    for (const message of ['Invalid completed score', 'Match is not ready to start', 'Service role required']) {
      const translated = errorMessage(new Error(message))
      expect(translated).not.toBe(unknownErrorMessage)
      expect(asciiOnly.test(translated)).toBe(false)
    }

    expect(logged).not.toHaveBeenCalled()
    logged.mockRestore()
  })
})
