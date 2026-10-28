import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { NextAuthConfig } from 'next-auth'

const mocks = vi.hoisted(() => ({ query: vi.fn(), compare: vi.fn(), get: vi.fn(), post: vi.fn(), config: null as unknown as NextAuthConfig, authorize: null as unknown as (input: unknown) => Promise<unknown> }))
vi.mock('next-auth', () => ({ default: vi.fn((config: NextAuthConfig) => { mocks.config = config; return { handlers: { GET: mocks.get, POST: mocks.post }, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() } }) }))
vi.mock('next-auth/providers/credentials', () => ({ default: vi.fn((config: { authorize: typeof mocks.authorize }) => { mocks.authorize = config.authorize; return config }) }))
vi.mock('bcryptjs', () => ({ default: { compare: mocks.compare } }))
vi.mock('@/lib/db', () => ({ getPool: () => ({ query: mocks.query }) }))

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks()
  vi.stubEnv('AUTH_SECRET', 'synthetic-auth-secret-with-at-least-32-characters')
  mocks.query.mockResolvedValue({ rows: [] }); mocks.compare.mockResolvedValue(true)
  await import('@/lib/auth')
})
afterEach(() => vi.unstubAllEnvs())

it.each([undefined, {}, { email: 42, password: 'secret' }, { email: 'e@example.test', password: null }, { email: '', password: 'secret' }])('does not query credentials for incomplete input %#', async credentials => {
  expect(await mocks.authorize(credentials)).toBeNull(); expect(mocks.query).not.toHaveBeenCalled()
})
it('returns only the authenticated identity and never the password hash', async () => {
  const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'e@example.test', role: 'employee', password_hash: 'hash' }
  mocks.query.mockResolvedValue({ rows: [user] })
  expect(await mocks.authorize({ email: user.email, password: 'secret' })).toEqual({ id: user.id, email: user.email, role: 'employee' })
  expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('expense_auth.credentials($1::text)'), [user.email])
  expect(mocks.compare).toHaveBeenCalledWith('secret', 'hash')
  mocks.compare.mockResolvedValue(false)
  expect(await mocks.authorize({ email: user.email, password: 'wrong' })).toBeNull()
})
it('rejects unknown accounts before password verification', async () => {
  expect(await mocks.authorize({ email: 'unknown@example.test', password: 'secret' })).toBeNull()
  expect(mocks.compare).not.toHaveBeenCalled()
})
it('refreshes initial and returning JWT roles using current account state', async () => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const jwt = mocks.config.callbacks!.jwt!
  mocks.query.mockResolvedValue({ rows: [{ email: 'now@example.test', role: 'employee' }] })
  expect(await jwt({ token: {}, user: { id, role: 'hr_admin' } } as Parameters<typeof jwt>[0])).toMatchObject({ id, role: 'employee', email: 'now@example.test' })
  mocks.query.mockResolvedValue({ rows: [] })
  expect(await jwt({ token: { id, role: 'hr_admin' } } as Parameters<typeof jwt>[0])).toBeNull()
})
it('projects verified claims onto sessions and supports a session without a user', async () => {
  const session = mocks.config.callbacks!.session!
  const token = { id: 'actor', role: 'manager' }
  expect(await session({ session: { user: { email: 'e@example.test' } }, token } as Parameters<typeof session>[0])).toEqual({ user: { id: 'actor', email: 'e@example.test', role: 'manager' } })
  expect(await session({ session: {}, token } as Parameters<typeof session>[0])).toEqual({})
  expect(mocks.config).toMatchObject({ session: { strategy: 'jwt' }, pages: { signIn: '/login' } })
})
it('delegates both Auth.js HTTP methods to the configured handlers', async () => {
  const { GET, POST } = await import('@/app/api/auth/[...nextauth]/route')
  expect(GET).toBe(mocks.get); expect(POST).toBe(mocks.post)
})
