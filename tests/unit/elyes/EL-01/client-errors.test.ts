import { describe, expect, it } from 'vitest'
import { formatRequestFailure, getClientErrorMessage, isConflict } from '@/utils/client-errors'

describe('client errors', () => {
  it('reads detail and error from safe JSON bodies', async () => {
    expect(await getClientErrorMessage(new Response(JSON.stringify({ detail: 'Conflit' }), { status: 400 }), 'fallback')).toBe('Conflit')
    expect(await getClientErrorMessage(new Response(JSON.stringify({ error: 'Invalid' }), { status: 400 }), 'fallback')).toBe('Invalid')
  })

  it('uses safe messages for auth, server, and malformed responses', async () => {
    expect(await getClientErrorMessage(new Response('', { status: 403 }), 'fallback')).toContain('droits')
    expect(await getClientErrorMessage(new Response('secret stack', { status: 500 }), 'fallback')).toContain('serveur')
    expect(await getClientErrorMessage(new Response('<html>', { status: 400 }), 'fallback')).toBe('fallback')
  })

  it('identifies conflicts and uncertain network writes', () => {
    expect(isConflict(new Response('', { status: 409 }))).toBe(true)
    expect(formatRequestFailure(new TypeError('offline'), 'fallback')).toContain('non confirmé')
  })
})
