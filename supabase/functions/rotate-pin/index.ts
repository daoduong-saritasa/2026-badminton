import {
  corsHeaders,
  jsonResponse,
  parsePin,
  serviceRpc,
  verifyIdentity,
} from '../_shared/server.ts'

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

  const rpcResponse = await serviceRpc('rotate_staff_pin_for_session', {
    p_session_id: identity.sessionId,
    p_user_id: identity.userId,
    p_pin: pin,
  })

  if (!rpcResponse.ok) {
    console.error('rotate-pin database operation failed', { status: rpcResponse.status })
    return jsonResponse({ error: 'pin_rotation_failed' }, rpcResponse.status === 403 ? 403 : 503)
  }

  return new Response(null, { status: 204, headers: corsHeaders })
})
