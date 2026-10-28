import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ query: vi.fn(), auth: vi.fn((handler: unknown) => handler), settings: vi.fn(), assertDatabase: vi.fn() }))
vi.mock('@/lib/ocr-settings', () => ({ ocrSettings: mocks.settings }))
vi.mock('@/lib/db', () => ({ getPool: () => ({ query: mocks.query }) }))
vi.mock('@/lib/runtime-database', () => ({ assertRuntimeDatabase: mocks.assertDatabase }))
vi.mock('@/lib/auth', () => ({ auth: mocks.auth }))
import { register } from '@/instrumentation'
import proxy from '@/proxy'
beforeEach(() => { vi.clearAllMocks(); mocks.settings.mockReturnValue({}); mocks.assertDatabase.mockResolvedValue(undefined); vi.stubEnv('NEXT_PHASE', undefined) })
afterEach(() => vi.unstubAllEnvs())
it.each(['edge', undefined])('does not initialize Node services for %s', async runtime => {
  vi.stubEnv('NEXT_RUNTIME', runtime); await register(); expect(mocks.settings).not.toHaveBeenCalled(); expect(mocks.assertDatabase).not.toHaveBeenCalled()
})
it('validates limits during builds without connecting to the database', async () => {
  vi.stubEnv('NEXT_RUNTIME', 'nodejs'); vi.stubEnv('NEXT_PHASE', 'phase-production-build'); await register()
  expect(mocks.settings).toHaveBeenCalledOnce(); expect(mocks.assertDatabase).not.toHaveBeenCalled()
})
it('refuses runtime startup when database protections fail', async () => {
  vi.stubEnv('NEXT_RUNTIME', 'nodejs'); await register(); expect(mocks.assertDatabase).toHaveBeenCalledWith({ query: mocks.query })
  mocks.assertDatabase.mockRejectedValue(new Error('unsafe database role'))
  await expect(register()).rejects.toThrow('unsafe database role')
})
it.each(['/expenses', '/manager/team', '/hr'])('redirects unauthenticated users away from %s', async path => {
  const run = proxy as unknown as (req: { nextUrl: URL; auth: unknown }) => Response | undefined
  const response = run({ nextUrl: new URL(path, 'http://localhost'), auth: null })
  expect(response?.headers.get('location')).toBe('http://localhost/login')
  expect(run({ nextUrl: new URL(path, 'http://localhost'), auth: { user: {} } })).toBeUndefined()
})
it('allows the public login page without a session', () => {
  const run = proxy as unknown as (req: { nextUrl: URL; auth: unknown }) => Response | undefined
  expect(run({ nextUrl: new URL('http://localhost/login'), auth: null })).toBeUndefined()
})
