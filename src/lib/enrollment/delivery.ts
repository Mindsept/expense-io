/** Configured private mail bridge; application responses never contain capabilities. */
export type Delivery = { intendedEmail: string; token: string; proofToken: string; expiresAt: string }

export function readInvitationDelivery(env: Record<string, string | undefined> = process.env) {
  const ttl = Number(env.ENROLLMENT_INVITATION_TTL_SECONDS)
  if (!env.ENROLLMENT_INVITATION_TTL_SECONDS || !Number.isSafeInteger(ttl) || ttl < 60 || ttl > 604800) {
    throw new Error('Invitation delivery is not configured.')
  }
  const bridge = new URL(env.ENROLLMENT_DELIVERY_URL || 'invalid:')
  const origin = new URL(env.AUTH_URL || 'invalid:')
  const isolated = env.ARLA_TEST_ENV === 'isolated'
  for (const url of [bridge, origin]) {
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    if (url.username || url.password || url.hash || url.search ||
        (url.protocol !== 'https:' && !(isolated && loopback && url.protocol === 'http:' && url.port && url.port !== '3000'))) {
      throw new Error('Invitation delivery is not configured.')
    }
  }
  if (origin.pathname !== '/' || !env.ENROLLMENT_DELIVERY_BEARER || env.ENROLLMENT_DELIVERY_BEARER.length < 32 || /[\r\n]/.test(env.ENROLLMENT_DELIVERY_BEARER)) {
    throw new Error('Invitation delivery is not configured.')
  }
  return { ttlSeconds: ttl, endpoint: bridge.href, origin: origin.origin, bearer: env.ENROLLMENT_DELIVERY_BEARER }
}

export async function deliverInvitation(delivery: Delivery, config = readInvitationDelivery()) {
  // Fragments never enter HTTP request URLs, referrers or application access logs.
  const link = `${config.origin}/signup#${delivery.token}.${delivery.proofToken}`
  try {
    const response = await fetch(config.endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5_000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.bearer}` },
      body: JSON.stringify({ type: 'expense-io.enrollment.v1', to: delivery.intendedEmail, link, expiresAt: delivery.expiresAt }),
    })
    if (response.status !== 202) throw new Error('delivery refused')
    await response.body?.cancel()
  } catch {
    // Provider responses/errors can contain raw capabilities or private credentials.
    throw new Error('Invitation delivery is unavailable.')
  }
}
