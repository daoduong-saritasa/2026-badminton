const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PIN_PATTERN = /^\d{4,12}$/

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface VerifiedIdentity {
  userId: string
  sessionId: string
}

interface JwtClaims {
  sub?: unknown
  session_id?: unknown
}

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)

  if (!value) {
    throw new Error(`Missing required server configuration: ${name}`)
  }

  return value
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization')
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i)
  return match?.[1] ?? null
}

function decodeClaims(token: string): JwtClaims | null {
  const encodedPayload = token.split('.')[1]

  if (!encodedPayload) {
    return null
  }

  try {
    const base64 = encodedPayload.replaceAll('-', '+').replaceAll('_', '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const claims: unknown = JSON.parse(atob(padded))
    return typeof claims === 'object' && claims !== null ? (claims as JwtClaims) : null
  } catch {
    return null
  }
}

export async function verifyIdentity(request: Request): Promise<VerifiedIdentity | null> {
  const token = bearerToken(request)

  if (!token) {
    return null
  }

  const supabaseUrl = requiredEnvironment('SUPABASE_URL')
  const anonymousKey = requiredEnvironment('SUPABASE_ANON_KEY')
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonymousKey,
      authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    return null
  }

  const user: unknown = await response.json()
  const claims = decodeClaims(token)
  const userId =
    typeof user === 'object' && user !== null && 'id' in user && typeof user.id === 'string'
      ? user.id
      : null
  const subject = typeof claims?.sub === 'string' ? claims.sub : null
  const sessionId = typeof claims?.session_id === 'string' ? claims.session_id : null

  if (
    !userId ||
    subject !== userId ||
    !sessionId ||
    !UUID_PATTERN.test(userId) ||
    !UUID_PATTERN.test(sessionId)
  ) {
    return null
  }

  return { userId, sessionId }
}

export async function parsePin(request: Request): Promise<string | null> {
  try {
    const body: unknown = await request.json()

    if (
      typeof body !== 'object' ||
      body === null ||
      !('pin' in body) ||
      typeof body.pin !== 'string' ||
      !PIN_PATTERN.test(body.pin)
    ) {
      return null
    }

    return body.pin
  } catch {
    return null
  }
}

export async function rateLimitBucket(userId: string): Promise<string> {
  const bytes = new TextEncoder().encode(userId)
  const digest = await crypto.subtle.digest('SHA-256', bytes)

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function serviceRpc(
  operation: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const supabaseUrl = requiredEnvironment('SUPABASE_URL')
  const serviceRoleKey = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY')

  return fetch(`${supabaseUrl}/rest/v1/rpc/${operation}`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

export function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: corsHeaders })
}
