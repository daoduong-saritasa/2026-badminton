import { z } from 'zod'

import type { StaffAccess, UUID } from '../domain/types'
import { getSupabaseClient } from '../lib/supabase'

const staffAccessSchema = z.object({
  sessionId: z.uuid(),
  expiresAt: z.string(),
})

const edgeErrorSchema = z.object({
  error: z.string(),
  retryAfterSeconds: z.number().int().positive().optional(),
})

export type StaffAccessErrorCode =
  | 'authentication_failed'
  | 'invalid_pin'
  | 'rate_limited'
  | 'staff_access_unavailable'
  | 'pin_rotation_failed'
  | 'invalid_response'

export class StaffAccessError extends Error {
  readonly code: StaffAccessErrorCode
  readonly retryAfterSeconds: number | null
  readonly cause: unknown

  constructor(
    code: StaffAccessErrorCode,
    message: string,
    options: { cause?: unknown; retryAfterSeconds?: number } = {},
  ) {
    super(message)
    this.name = 'StaffAccessError'
    this.code = code
    this.retryAfterSeconds = options.retryAfterSeconds ?? null
    this.cause = options.cause
  }
}

function parseStaffAccess(value: unknown): StaffAccess {
  const result = staffAccessSchema.safeParse(value)
  if (!result.success) {
    console.error('Staff access validation failed', { issues: result.error.issues })
    throw new StaffAccessError('invalid_response', 'The server returned invalid staff access data')
  }
  return result.data
}

function validatePin(pin: string): void {
  if (!/^\d{4,12}$/.test(pin)) {
    throw new StaffAccessError('invalid_pin', 'Enter a PIN containing 4 to 12 digits')
  }
}

async function readEdgeError(error: unknown): Promise<StaffAccessError> {
  const context =
    typeof error === 'object' && error !== null && 'context' in error
      ? error.context
      : null

  if (context instanceof Response) {
    const result = edgeErrorSchema.safeParse(await context.clone().json().catch(() => null))
    if (result.success) {
      if (result.data.error === 'rate_limited') {
        return new StaffAccessError(
          'rate_limited',
          'Too many incorrect PIN attempts. Wait before trying again.',
          { cause: error, retryAfterSeconds: result.data.retryAfterSeconds },
        )
      }
      if (result.data.error === 'invalid_pin' || result.data.error === 'invalid_pin_format') {
        return new StaffAccessError('invalid_pin', 'The staff PIN is incorrect', { cause: error })
      }
      if (result.data.error === 'pin_rotation_failed') {
        return new StaffAccessError('pin_rotation_failed', 'The staff PIN could not be rotated', { cause: error })
      }
    }
  }

  return new StaffAccessError('staff_access_unavailable', 'Staff access is unavailable', { cause: error })
}

async function ensureAnonymousSession(): Promise<void> {
  const client = getSupabaseClient()
  const { data: existing, error: sessionError } = await client.auth.getSession()
  if (sessionError) {
    throw new StaffAccessError('authentication_failed', 'The current session could not be restored', { cause: sessionError })
  }
  if (existing.session !== null) return

  const { error } = await client.auth.signInAnonymously()
  if (error) {
    throw new StaffAccessError('authentication_failed', 'An anonymous staff session could not be created', { cause: error })
  }
}

export async function signInStaff(pin: string): Promise<StaffAccess> {
  validatePin(pin)
  await ensureAnonymousSession()
  const { data, error } = await getSupabaseClient().functions.invoke('staff-pin', {
    body: { pin },
  })
  if (error) throw await readEdgeError(error)
  return parseStaffAccess(data)
}

export async function getStaffAccess(): Promise<StaffAccess | null> {
  const { data: sessionData, error: sessionError } = await getSupabaseClient().auth.getSession()
  if (sessionError) {
    throw new StaffAccessError('authentication_failed', 'The current session could not be restored', { cause: sessionError })
  }
  if (sessionData.session === null) return null

  const { data, error } = await getSupabaseClient().rpc('get_staff_access')
  if (error) {
    throw new StaffAccessError('staff_access_unavailable', 'Staff access could not be verified', { cause: error })
  }
  if (data === null) return null
  return parseStaffAccess(data)
}

export async function signOutStaff(): Promise<void> {
  const client = getSupabaseClient()
  const { data: sessionData, error: sessionError } = await client.auth.getSession()
  if (sessionError) {
    throw new StaffAccessError('authentication_failed', 'The current session could not be restored', { cause: sessionError })
  }

  if (sessionData.session !== null) {
    const { error: revokeError } = await client.rpc('revoke_staff_access')
    if (revokeError) {
      throw new StaffAccessError(
        'staff_access_unavailable',
        'Staff access could not be revoked. The browser session remains signed in so you can retry.',
        { cause: revokeError },
      )
    }
  }

  const { error: signOutError } = await client.auth.signOut({ scope: 'local' })
  if (signOutError) {
    throw new StaffAccessError('authentication_failed', 'The local staff session could not be cleared', { cause: signOutError })
  }
}

export async function rotateStaffPin(pin: string): Promise<void> {
  validatePin(pin)
  const { error } = await getSupabaseClient().functions.invoke('rotate-pin', {
    body: { pin },
  })
  if (error) throw await readEdgeError(error)
}

export async function canScore(matchId: UUID): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc('get_score_access', {
    p_match_id: matchId,
  })
  if (error) {
    throw new StaffAccessError('staff_access_unavailable', 'Score ownership could not be verified', { cause: error })
  }
  return data
}
