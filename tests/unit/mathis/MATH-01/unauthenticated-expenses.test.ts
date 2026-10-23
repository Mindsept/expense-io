import { NextRequest } from 'next/server'
import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), pool: vi.fn(), scope: vi.fn() }))
const requestId = '11111111-1111-4111-8111-111111111111'
vi.mock('@/lib/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/db', () => ({ getPool: mocks.pool, withUserScope: mocks.scope }))
vi.mock('@/lib/storage', () => ({ receiptKeyFor: vi.fn(), uploadReceipt: vi.fn() }))
import { GET } from '@/app/api/expense-notes/route'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.pool.mockImplementation(() => { throw new Error('Unexpected database access') })
  mocks.scope.mockImplementation(() => { throw new Error('Unexpected database scope') })
})

test.each([null, {}])('GET without an authenticated user returns 401 before any database access: %j', async (session) => {
  mocks.auth.mockResolvedValue(session)
  const response = await GET(new NextRequest('http://127.0.0.1/api/expense-notes', {
    headers: { 'X-Request-Id': requestId },
  }))
  expect(response.status).toBe(401)
  expect(response.headers.get('content-type')).toBe('application/problem+json')
  expect(response.headers.get('x-request-id')).toBe(requestId)
  expect(await response.json()).toEqual({
    type: 'urn:expense-io:problem:unauthenticated', title: 'Authentication required',
    status: 401, detail: 'Sign in to continue.', error: 'Sign in to continue.', requestId,
  })
  expect(mocks.auth).toHaveBeenCalledOnce()
  expect(mocks.pool).not.toHaveBeenCalled()
  expect(mocks.scope).not.toHaveBeenCalled()
})
