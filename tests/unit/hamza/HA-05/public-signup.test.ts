import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getPool: vi.fn(), hash: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), redeem: vi.fn() }))
vi.mock('next-auth', () => ({ AuthError: class AuthError extends Error {} }))
vi.mock('@/lib/enrollment/invitations', async (original) => ({ ...await original<typeof import('@/lib/enrollment/invitations')>(), redeemInvitation: mocks.redeem }))
vi.mock('@/lib/db', () => ({ getPool: mocks.getPool }))
vi.mock('bcryptjs', () => ({ default: { hash: mocks.hash } }))
vi.mock('@/lib/auth', () => ({ signIn: mocks.signIn, signOut: mocks.signOut }))

import { AuthError } from 'next-auth'
import { login, signup } from '@/app/actions/auth'

beforeEach(() => { vi.clearAllMocks() })

describe('legacy public enrollment refuses unverified affiliation', () => {
  it.each([
    { name: 'Claimed colleague', email: 'person@existing-company.test', password: 'test-only-password' },
    { name: 'Claimed first HR', email: 'person@new-company.test', password: 'test-only-password' },
    { name: 'Forged invitation', email: 'person@existing-company.test', password: 'test-only-password', companyId: 'forged', role: 'hr_admin', verifiedEmail: 'person@existing-company.test', token: 'self-declared' },
    {},
  ])('does not create or authenticate an account from submitted fields (case %#)', async fields => {
    const form = new FormData()
    for (const [key, value] of Object.entries(fields)) form.set(key, value)
    const result = await signup({}, form)
    expect(result.error).toContain("L'inscription nécessite une invitation")
    expect(mocks.getPool).not.toHaveBeenCalled()
    expect(mocks.hash).not.toHaveBeenCalled()
    expect(mocks.signIn).not.toHaveBeenCalled()
    for (const value of Object.values(fields)) expect(result.error).not.toContain(value)
  })
})


describe('existing-account login remains available', () => {
  function credentials() {
    const form = new FormData()
    form.set('email', 'existing@example.test')
    form.set('password', 'test-only-password')
    return form
  }

  it('preserves the authentication navigation exception', async () => {
    const redirect = new Error('NEXT_REDIRECT')
    mocks.signIn.mockRejectedValueOnce(redirect)
    await expect(login({}, credentials())).rejects.toBe(redirect)
    expect(mocks.signIn).toHaveBeenCalledWith('credentials', { email: 'existing@example.test', password: 'test-only-password', redirectTo: '/expenses' })
  })

  it('returns a bounded credential error without retrying enrollment', async () => {
    mocks.signIn.mockRejectedValueOnce(new AuthError('private provider detail'))
    await expect(login({}, credentials())).resolves.toEqual({ error: 'Email ou mot de passe incorrect.' })
    expect(mocks.signIn).toHaveBeenCalledOnce()
    expect(mocks.getPool).not.toHaveBeenCalled()
  })
})


describe('verified invitation action', () => {
  function invitedForm() {
    const form = new FormData()
    for (const [key, value] of Object.entries({ invitation: 'private-invite', emailProof: 'private-proof', name: 'Person', password: 'test-only-password', verifiedEmail: 'forged@foreign.test', companyId: 'forged', role: 'hr_admin' })) form.set(key, value)
    return form
  }
  it('uses only server-verified enrollment email for automatic sign-in and preserves redirects', async () => {
    mocks.redeem.mockResolvedValueOnce({ email: 'invited@example.test', kind: 'account_created' })
    const redirect = new Error('NEXT_REDIRECT')
    mocks.signIn.mockRejectedValueOnce(redirect)
    await expect(signup({}, invitedForm())).rejects.toBe(redirect)
    expect(mocks.redeem.mock.calls.at(-1)?.[1]).toEqual({ token: 'private-invite', emailProof: 'private-proof', name: 'Person', password: 'test-only-password' })
    expect(mocks.signIn).toHaveBeenLastCalledWith('credentials', { email: 'invited@example.test', password: 'test-only-password', redirectTo: '/expenses' })
  })
  it('preserves committed-account state after an automatic credential failure', async () => {
    mocks.redeem.mockResolvedValueOnce({ email: 'invited@example.test', kind: 'account_created' })
    mocks.signIn.mockRejectedValueOnce(new AuthError('private provider cause'))
    const result = await signup({}, invitedForm())
    expect(result.accountCreated).toBe(true)
    expect(result.error).toContain('ne recréez pas le compte')
    expect(result.error).not.toContain('private provider cause')
    expect(mocks.redeem).toHaveBeenCalledOnce()
  })
})
