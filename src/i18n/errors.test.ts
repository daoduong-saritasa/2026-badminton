import { describe, expect, it, vi } from 'vitest'

import { errorMessage, unknownErrorMessage } from './errors'

describe('errorMessage', () => {
  it('translates a known server failure', () => {
    expect(errorMessage(new Error('Tournament version conflict')))
      .toBe('Giải đấu vừa thay đổi. Hãy tải lại và thử lại.')
  })

  it('translates a correction block raised by the server', () => {
    expect(errorMessage(new Error('placement-started'))).toContain('tranh hạng')
    expect(errorMessage(new Error('playoff-started'))).toContain('Trận tranh vé')
  })

  it('translates pair assignment and qualification failures', () => {
    expect(errorMessage(new Error('Pair must mix seeds'))).toBe('Trận này cần một hạt giống 1 và một hạt giống 2.')
    expect(errorMessage(new Error('Pairs are fixed after the match starts'))).toBe('Trận đã bắt đầu nên cặp không đổi được.')
    expect(errorMessage(new Error('Third place must finish before the final starts')))
      .toBe('Tranh hạng ba phải kết thúc trước khi chung kết bắt đầu.')
  })

  it('tells an ownership conflict apart from a missing role', () => {
    expect(errorMessage(new Error('This session does not own the match')))
      .toBe('Thiết bị khác đang ghi điểm trận này.')
    expect(errorMessage(new Error('Organizer access required'))).toBe('Cần quyền điều hành.')
  })

  it('accepts a plain string and a PostgREST-shaped object', () => {
    expect(errorMessage('Court is occupied')).toBe('Sân này đang có trận khác thi đấu.')
    expect(errorMessage({ message: 'Court is occupied' })).toBe('Sân này đang có trận khác thi đấu.')
  })

  it('tolerates surrounding whitespace', () => {
    expect(errorMessage(new Error('  Court is occupied  '))).toBe('Sân này đang có trận khác thi đấu.')
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

    for (const message of [
      'Game does not have a valid winning score',
      'Decider is not eligible',
      'Service role required',
      // Raised by the pair assignment migration.
      'Invalid pair assignment',
      'Pairs are fixed after the match starts',
      'Pair assignment is not open for this match',
      'A pair requires two distinct players',
      'Pair players must belong to the team',
      'Pair must mix seeds',
      'Player already plays in this fixture',
      'Qualifying requires four complete teams',
    ]) {
      const translated = errorMessage(new Error(message))
      expect(translated).not.toBe(unknownErrorMessage)
      expect(asciiOnly.test(translated)).toBe(false)
    }

    expect(logged).not.toHaveBeenCalled()
    logged.mockRestore()
  })
})
