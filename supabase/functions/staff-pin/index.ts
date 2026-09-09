import {
  corsHeaders,
  jsonResponse,
  parsePin,
  rateLimitBucket,
  serviceRpc,
  verifyIdentity,
} from '../_shared/server.ts'

interface ExchangeResult {
  ok?: unknown
  error?: unknown
  retryAfterSeconds?: unknown
  access?: unknown
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405)
  }

  const identity = await verifyIdentity(request)
  const pin = await parsePin(request)

  if (!identity) {
    return jsonResponse({ error: 'authentication_required' }, 401)
  }

  if (!pin) {
    return jsonResponse({ error: 'invalid_pin_format' }, 400)
  }

  const bucket = await rateLimitBucket(identity.userId)
  const rpcResponse = await serviceRpc('exchange_staff_pin', {
    p_session_id: identity.sessionId,
    p_user_id: identity.userId,
    p_bucket: bucket,
    p_pin: pin,
  })

  if (!rpcResponse.ok) {
    console.error('staff-pin database operation failed', { status: rpcResponse.status })
    return jsonResponse({ error: 'staff_access_unavailable' }, 503)
  }

  const result = (await rpcResponse.json()) as ExchangeResult

  if (result.ok !== true) {
    if (result.error === 'rate_limited' && typeof result.retryAfterSeconds === 'number') {
      const response = jsonResponse(
        { error: 'rate_limited', retryAfterSeconds: result.retryAfterSeconds },
        429,
      )
      response.headers.set('Retry-After', String(result.retryAfterSeconds))
      return response
    }

    return jsonResponse({ error: 'invalid_pin' }, 401)
  }

  return jsonResponse(result.access, 200)
})
