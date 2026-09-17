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

  it('keeps authorization, ownership, PIN, audit, and maintenance state outside public reads', () => {
    const privileges = runSql(
      [
        "select concat_ws(',',",
        "  has_table_privilege('anon', 'private.staff_grants', 'select'),",
        "  has_table_privilege('authenticated', 'private.match_ownership', 'select'),",
        "  has_table_privilege('anon', 'private.staff_config', 'select'),",
        "  has_table_privilege('authenticated', 'private.mutation_log', 'select'),",
        "  has_table_privilege('anon', 'private.maintenance_state', 'select'),",
        "  has_table_privilege('authenticated', 'public.tournament_generation', 'select')",
        ');',
      ].join('\n'),
    )
    expect(privileges).toBe('false,false,false,false,false,true')
  })

  it('rejects expired and explicitly revoked grants', async () => {
    const session = await signInAnonymously()
    await elevate(session)

    const activeResponse = await rpc('get_staff_access', {}, session)
    expect(activeResponse.ok).toBe(true)
    expect(await activeResponse.json()).toMatchObject({
      sessionId: session.sessionId,
      role: 'organizer',
    })

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

  it('rotates the organizer PIN, revokes organizer grants, and preserves the rotating session', async () => {
    const rotatingSession = await signInAnonymously()
    const staleSession = await signInAnonymously()
    await elevate(rotatingSession)
    await elevate(staleSession)

    const rotationResponse = await edgeRequest(
      'rotate-pin',
      rotatingSession,
      '8642',
      'organizer',
    )
    expect(rotationResponse.status).toBe(204)

    const currentAccess = await rpc('get_staff_access', {}, rotatingSession)
    expect(await currentAccess.json()).toMatchObject({
      sessionId: rotatingSession.sessionId,
      role: 'organizer',
    })
    const staleAccess = await rpc('get_staff_access', {}, staleSession)
    expect(await staleAccess.json()).toBeNull()

    const newSession = await signInAnonymously()
    expect((await edgeRequest('staff-pin', newSession, '2468')).status).toBe(401)
    expect((await edgeRequest('staff-pin', newSession, '8642')).status).toBe(200)
  })

  it('issues referee grants without organizer command or preview access', async () => {
    const referee = await signInAnonymously()
    await elevate(referee, '1357')

    const access = await rpc('get_staff_access', {}, referee)
    expect(await access.json()).toMatchObject({
      sessionId: referee.sessionId,
      role: 'referee',
    })

    const organizerCommand = await rpc(
      'save_setup',
      mutation(0, { setup: {} }),
      referee,
    )
    expect([401, 403]).toContain(organizerCommand.status)

    const preview = await rpc(
      'preview_result_correction',
      {
        p_match_id: crypto.randomUUID(),
        p_score: { a: 21, b: 19 },
        p_reset_generation: 0,
      },
      referee,
    )
    expect([401, 403]).toContain(preview.status)
  })

  it('allows both roles through scorer authorization', async () => {
    for (const pin of ['2468', '1357']) {
      const session = await signInAnonymously()
      await elevate(session, pin)
      const response = await rpc(
        'start_scoring',
        mutation(0, { matchId: crypto.randomUUID() }),
        session,
      )

      expect([401, 403]).not.toContain(response.status)
    }
  })

  it('rejects PIN rotation by a referee', async () => {
    const referee = await signInAnonymously()
    await elevate(referee, '1357')

    const response = await edgeRequest('rotate-pin', referee, '9753', 'referee')
    expect(response.status).toBe(403)
  })

  it('rejects an unknown rotation role before calling the database', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)

    const response = await edgeRequest('rotate-pin', organizer, '9753', 'spectator')
    expect(response.status).toBe(400)
  })

  it('rotates one role without revoking grants for the other role', async () => {
    const organizer = await signInAnonymously()
    const referee = await signInAnonymously()
    await elevate(organizer)
    await elevate(referee, '1357')

    const rotation = await edgeRequest('rotate-pin', organizer, '9753', 'referee')
    expect(rotation.status).toBe(204)

    const organizerAccess = await rpc('get_staff_access', {}, organizer)
    expect(await organizerAccess.json()).toMatchObject({ role: 'organizer' })
    const refereeAccess = await rpc('get_staff_access', {}, referee)
    expect(await refereeAccess.json()).toBeNull()

    const newReferee = await signInAnonymously()
    expect((await edgeRequest('staff-pin', newReferee, '1357')).status).toBe(401)
    const newAccess = await edgeRequest('staff-pin', newReferee, '9753')
    expect(newAccess.status).toBe(200)
    expect(await newAccess.json()).toMatchObject({ role: 'referee' })
  })

  it('rejects assigning the same PIN to both roles', async () => {
    const organizer = await signInAnonymously()
    await elevate(organizer)

    const response = await edgeRequest('rotate-pin', organizer, '1357', 'organizer')
    expect(response.status).toBe(503)
  })

  it('revokes every active grant during the role migration transition', async () => {
    const organizer = await signInAnonymously()
    const referee = await signInAnonymously()
    await elevate(organizer)
    await elevate(referee, '1357')

    runSql(
      'update private.staff_grants set revoked_at = clock_timestamp() where revoked_at is null;',
    )

    expect(await (await rpc('get_staff_access', {}, organizer)).json()).toBeNull()
    expect(await (await rpc('get_staff_access', {}, referee)).json()).toBeNull()
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
