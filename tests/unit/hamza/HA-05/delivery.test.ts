import { afterEach, describe, expect, it, vi } from 'vitest'
import { deliverInvitation, readInvitationDelivery } from '@/lib/enrollment/delivery'

const settings = { ENROLLMENT_INVITATION_TTL_SECONDS:'3600', ENROLLMENT_DELIVERY_URL:'https://mail.example.test/private', ENROLLMENT_DELIVERY_BEARER:'x'.repeat(40), AUTH_URL:'https://expense.example.test' }
afterEach(() => vi.unstubAllGlobals())

describe('private invitation delivery', () => {
  it.each([
    {ENROLLMENT_INVITATION_TTL_SECONDS:undefined}, {ENROLLMENT_INVITATION_TTL_SECONDS:'NaN'}, {ENROLLMENT_INVITATION_TTL_SECONDS:'0'},
    {ENROLLMENT_DELIVERY_URL:'http://mail.example.test/private'}, {ENROLLMENT_DELIVERY_URL:'https://user:password@mail.example.test/private'},
    {ENROLLMENT_DELIVERY_URL:'https://mail.example.test/private?secret=bad'}, {ENROLLMENT_DELIVERY_BEARER:'short'},
    {AUTH_URL:'https://expense.example.test/subpath'},
  ])('refuses absent expiry or unsafe delivery settings (case %#)', patch => {
    expect(() => readInvitationDelivery({...settings,...patch})).toThrow()
  })
  it('uses an explicit expiry and only allows cleartext loopback in the isolated fixture', () => {
    expect(readInvitationDelivery(settings).ttlSeconds).toBe(3600)
    expect(readInvitationDelivery({...settings, ARLA_TEST_ENV:'isolated', ENROLLMENT_DELIVERY_URL:'http://127.0.0.1:3136/mail',AUTH_URL:'http://127.0.0.1:3135'}).origin).toBe('http://127.0.0.1:3135')
    expect(() => readInvitationDelivery({...settings, ARLA_TEST_ENV:'isolated', ENROLLMENT_DELIVERY_URL:'http://foreign.test:3136/mail'})).toThrow()
  })
  it('sends both capabilities only to the configured private bridge with no redirect following', async () => {
    const transport = vi.fn().mockResolvedValue(new Response(null,{status:202}))
    vi.stubGlobal('fetch',transport)
    await deliverInvitation({intendedEmail:'intended@example.test',token:'invite',proofToken:'proof',expiresAt:'2026-10-25T00:00:00.000Z'},readInvitationDelivery(settings))
    const [url,request] = transport.mock.calls[0]
    expect(url).toBe(settings.ENROLLMENT_DELIVERY_URL)
    expect(request.redirect).toBe('error')
    expect(JSON.parse(request.body)).toMatchObject({to:'intended@example.test',link:'https://expense.example.test/signup#invite.proof'})
    expect(request.headers.Authorization).toBe(`Bearer ${settings.ENROLLMENT_DELIVERY_BEARER}`)
  })
  it.each([new Response('private capability',{status:503}),new Response(null,{status:302})])('bounds unsuccessful provider output', async response => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response))
    await expect(deliverInvitation({intendedEmail:'intended@example.test',token:'invite',proofToken:'proof',expiresAt:'later'},readInvitationDelivery(settings))).rejects.toThrow('Invitation delivery is unavailable.')
  })
})
