import { describe, expect, it, vi } from 'vitest'

import {
  parseMaintenanceAction,
  resetConfirmation,
  runMaintenance,
  targetHost,
} from './reset-tournament.ts'

const environment = {
  BADMINTON_MAINTENANCE_URL: 'https://example.supabase.co/rest/v1?token=secret',
  BADMINTON_MAINTENANCE_SERVICE_ROLE_KEY: 'service-secret',
}
const target = {
  resetGeneration: 4,
  snapshot: {
    tournament: {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Saturday Open',
      version: 12,
    },
  },
}

describe('maintenance command', () => {
  it('parses only explicit actions and reset modes', () => {
    expect(parseMaintenanceAction(['enable'])).toEqual({ kind: 'enable' })
    expect(parseMaintenanceAction(['disable'])).toEqual({ kind: 'disable' })
    expect(parseMaintenanceAction(['reset', '--mode', 'progress'])).toEqual({ kind: 'reset', mode: 'progress' })
    expect(() => parseMaintenanceAction(['reset', '--mode', 'invalid'])).toThrow('Usage')
  })

  it('shows only the sanitized target host', () => {
    expect(targetHost(environment.BADMINTON_MAINTENANCE_URL)).toBe('https://example.supabase.co')
  })

  it('cancels without calling reset when confirmation does not match', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: target, error: null })
    const write = vi.fn()
    await runMaintenance(
      { kind: 'reset', mode: 'all' },
      environment,
      { write, confirm: vi.fn().mockResolvedValue('no') },
      () => ({ rpc }),
    )

    expect(rpc).toHaveBeenCalledOnce()
    expect(write).toHaveBeenLastCalledWith('Reset cancelled')
    expect(write.mock.calls.flat().join(' ')).not.toContain('service-secret')
  })

  it('uses one request ID and the exact observed target without retrying', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: target, error: null })
      .mockResolvedValueOnce({ data: { resetGeneration: 5 }, error: null })
    const confirmation = resetConfirmation({
      resetGeneration: 4,
      id: target.snapshot.tournament.id,
      name: target.snapshot.tournament.name,
      version: 12,
    }, 'progress')

    await runMaintenance(
      { kind: 'reset', mode: 'progress' },
      environment,
      { write: vi.fn(), confirm: vi.fn().mockResolvedValue(confirmation) },
      () => ({ rpc }),
    )

    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenLastCalledWith('reset_tournament', expect.objectContaining({
      p_expected_generation: 4,
      p_expected_tournament_id: target.snapshot.tournament.id,
      p_expected_version: 12,
      p_mode: 'progress',
      p_confirmation_name: 'Saturday Open',
      p_request_id: expect.any(String),
    }))
  })

  it('enables and disables reset independently', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    const makeClient = () => ({ rpc })
    const io = { write: vi.fn(), confirm: vi.fn() }

    await runMaintenance({ kind: 'enable' }, environment, io, makeClient)
    await runMaintenance({ kind: 'disable' }, environment, io, makeClient)

    expect(rpc).toHaveBeenNthCalledWith(1, 'set_reset_enabled', { p_enabled: true })
    expect(rpc).toHaveBeenNthCalledWith(2, 'set_reset_enabled', { p_enabled: false })
  })
})
