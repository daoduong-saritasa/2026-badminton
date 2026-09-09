import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const databaseContainer = 'supabase_db_badminton'

interface LocalStatus {
  apiUrl: string
  anonKey: string
  serviceRoleKey: string
}

export interface LocalSession {
  accessToken: string
  sessionId: string
  userId: string
}

interface AnonymousSignInResponse {
  access_token?: unknown
  user?: { id?: unknown } | null
}

let cachedStatus: LocalStatus | null = null

function parseEnvironment(output: string): Map<string, string> {
  const values = new Map<string, string>()

  for (const line of output.split('\n')) {
    const match = line.match(/^([A-Z_]+)="(.*)"$/)
    if (match) values.set(match[1], match[2])
  }

  return values
}

function required(values: Map<string, string>, name: string): string {
  const value = values.get(name)
  if (!value) throw new Error(`Supabase status did not return ${name}`)
  return value
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1]
  if (!payload) throw new Error('Anonymous Auth returned a malformed access token')

  const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  if (typeof decoded !== 'object' || decoded === null) {
    throw new Error('Anonymous Auth returned invalid token claims')
  }
  return decoded as Record<string, unknown>
}

export function localStatus(): LocalStatus {
  if (cachedStatus) return cachedStatus

  try {
    const output = execFileSync(
      path.join(projectRoot, 'node_modules/.bin/supabase'),
      ['status', '--output', 'env'],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    const values = parseEnvironment(output)
    cachedStatus = {
      apiUrl: required(values, 'API_URL'),
      anonKey: required(values, 'ANON_KEY'),
      serviceRoleKey: required(values, 'SERVICE_ROLE_KEY'),
    }
    return cachedStatus
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Local Supabase is unavailable. Run \`npm exec supabase -- start\` and ` +
        `\`npm exec supabase -- db reset\` before the integration suite. ${reason}`,
    )
  }
}

export async function requireLocalSupabase(): Promise<LocalStatus> {
  const status = localStatus()

  try {
    const response = await fetch(`${status.apiUrl}/auth/v1/health`, {
      headers: { apikey: status.anonKey },
      signal: AbortSignal.timeout(2_000),
    })
    if (!response.ok) throw new Error(`Auth health returned ${response.status}`)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Local Supabase services are not healthy. ${reason}`)
  }

  return status
}

export function runSql(statement: string): string {
  try {
    return execFileSync(
      'docker',
      [
        'exec',
        databaseContainer,
        'psql',
        '--username',
        'postgres',
        '--dbname',
        'postgres',
        '--no-psqlrc',
        '--tuples-only',
        '--quiet',
        '--set',
        'ON_ERROR_STOP=1',
        '--command',
        statement,
      ],
      { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Local Supabase fixture SQL failed. ${reason}`)
  }
}

export function resetLocalDatabase(pin = '2468'): void {
  if (!/^\d{4,12}$/.test(pin)) throw new Error('Test PIN must contain 4 to 12 digits')

  runSql(`
    truncate table
      private.mutation_log,
      private.match_ownership,
      private.staff_grants,
      private.pin_attempts,
      private.staff_config,
      public.tie_resolutions,
      public.matches,
      public.pairs,
      public.players,
      public.tournament
    cascade;
    insert into private.staff_config (singleton, pin_hash, generation)
    values (true, extensions.crypt('${pin}', extensions.gen_salt('bf', 4)), 1);
  `)
}

export async function signInAnonymously(): Promise<LocalSession> {
  const status = localStatus()
  const response = await fetch(`${status.apiUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: status.anonKey, 'content-type': 'application/json' },
    body: '{}',
  })
  const body = (await response.json()) as AnonymousSignInResponse
  const accessToken = typeof body.access_token === 'string' ? body.access_token : null
  const userId = typeof body.user?.id === 'string' ? body.user.id : null

  if (!response.ok || !accessToken || !userId) {
    throw new Error(`Anonymous Auth failed with status ${response.status}`)
  }

  const sessionId = decodeJwtPayload(accessToken).session_id
  if (typeof sessionId !== 'string') throw new Error('Anonymous token has no session_id claim')
  return { accessToken, sessionId, userId }
}

export async function edgeRequest(
  operation: 'staff-pin' | 'rotate-pin',
  session: LocalSession,
  pin: string,
): Promise<Response> {
  const status = localStatus()
  return fetch(`${status.apiUrl}/functions/v1/${operation}`, {
    method: 'POST',
    headers: {
      apikey: status.anonKey,
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ pin }),
  })
}

export async function rpc(
  operation: string,
  body: Record<string, unknown>,
  session?: LocalSession,
): Promise<Response> {
  const status = localStatus()
  const key = session ? status.anonKey : status.serviceRoleKey
  const token = session?.accessToken ?? status.serviceRoleKey

  return fetch(`${status.apiUrl}/rest/v1/rpc/${operation}`, {
    method: 'POST',
    headers: {
      apikey: key,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

export async function anonymousRpc(
  operation: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const status = localStatus()
  return fetch(`${status.apiUrl}/rest/v1/rpc/${operation}`, {
    method: 'POST',
    headers: {
      apikey: status.anonKey,
      authorization: `Bearer ${status.anonKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

export async function elevate(session: LocalSession, pin = '2468'): Promise<void> {
  const response = await edgeRequest('staff-pin', session, pin)
  if (!response.ok) throw new Error(`Staff elevation failed with status ${response.status}`)
}

export function mutation(
  expectedVersion: number,
  payload: Record<string, unknown>,
  requestId: string = crypto.randomUUID(),
): Record<string, unknown> {
  return {
    p_request_id: requestId,
    p_expected_version: expectedVersion,
    p_payload: payload,
  }
}
