import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  anonymousRpc,
  edgeRequest,
  elevate,
  mutation,
  requireLocalSupabase,
  resetLocalDatabase,
  rpc,
  runSql,
  signInAnonymously,
} from './local-supabase.ts'

describe('staff authorization', () => {
  beforeAll(async () => {
    await requireLocalSupabase()
  })

  beforeEach(() => {
    resetLocalDatabase()
  })

  it('denies mutations to public viewers and Auth sessions without a staff grant', async () => {
    const payload = mutation(0, { setup: {} })
    const viewerResponse = await anonymousRpc('save_setup', payload)
    expect(viewerResponse.ok).toBe(false)

    const session = await signInAnonymously()
    const sessionResponse = await rpc('save_setup', payload, session)
    expect(sessionResponse.ok).toBe(false)
    expect([401, 403]).toContain(sessionResponse.status)
  })

  it('keeps authorization, ownership, PIN, and audit tables outside public reads', () => {
    const privileges = runSql(
      [
        "select concat_ws(',',",
        "  has_table_privilege('anon', 'private.staff_grants', 'select'),",
        "  has_table_privilege('authenticated', 'private.match_ownership', 'select'),",
        "  has_table_privilege('anon', 'private.staff_config', 'select'),",
        "  has_table_privilege('authenticated', 'private.mutation_log', 'select')",
        ');',
      ].join('\n'),
    )
    expect(privileges).toBe('false,false,false,false')
  })

  it('rejects expired and explicitly revoked grants', async () => {
    const session = await signInAnonymously()
    await elevate(session)

    const activeResponse = await rpc('get_staff_access', {}, session)
    expect(activeResponse.ok).toBe(true)
    expect(await activeResponse.json()).toMatchObject({ sessionId: session.sessionId })

    runSql(
      `update private.staff_grants set granted_at = clock_timestamp() - interval '8 days', ` +
        `expires_at = clock_timestamp() - interval '1 day' ` +
        `where session_id = '${session.sessionId}'::uuid;`,
    )
    const expiredResponse = await rpc('get_staff_access', {}, session)
    expect(expiredResponse.ok).toBe(true)
    expect(await expiredResponse.json()).toBeNull()

    await elevate(session)
    const revokeResponse = await rpc('revoke_staff_access', {}, session)
    expect(revokeResponse.ok).toBe(true)
    const revokedResponse = await rpc('get_staff_access', {}, session)
    expect(await revokedResponse.json()).toBeNull()
  })

  it('rotates the PIN, revokes other grants, and preserves the rotating session', async () => {
    const rotatingSession = await signInAnonymously()
    const staleSession = await signInAnonymously()
    await elevate(rotatingSession)
    await elevate(staleSession)

    const rotationResponse = await edgeRequest('rotate-pin', rotatingSession, '8642')
    expect(rotationResponse.status).toBe(204)

    const currentAccess = await rpc('get_staff_access', {}, rotatingSession)
    expect(await currentAccess.json()).toMatchObject({ sessionId: rotatingSession.sessionId })
    const staleAccess = await rpc('get_staff_access', {}, staleSession)
    expect(await staleAccess.json()).toBeNull()

    const newSession = await signInAnonymously()
    expect((await edgeRequest('staff-pin', newSession, '2468')).status).toBe(401)
    expect((await edgeRequest('staff-pin', newSession, '8642')).status).toBe(200)
  })

  it('rate limits the fifth failed PIN attempt for one verified user', async () => {
    const session = await signInAnonymously()

    for (let attempt = 1; attempt < 5; attempt += 1) {
      expect((await edgeRequest('staff-pin', session, '0000')).status).toBe(401)
    }

    const blockedResponse = await edgeRequest('staff-pin', session, '0000')
    expect(blockedResponse.status).toBe(429)
    expect(blockedResponse.headers.get('retry-after')).toBeTruthy()
    expect((await edgeRequest('staff-pin', session, '2468')).status).toBe(429)
  })
})
