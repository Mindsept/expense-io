import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), query: vi.fn(), connect: vi.fn(), release: vi.fn(), receipt: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/storage', () => ({ getReceiptUrl: mocks.receipt }))
vi.mock('pg', () => ({
  Pool: vi.fn(function () { return { query: mocks.query, connect: mocks.connect } }),
  types: { setTypeParser: vi.fn() },
}))

import { GET as managerList } from '../../../../src/app/api/manager/expense-notes/route'
import { POST as managerApprove } from '../../../../src/app/api/manager/expense-notes/[id]/approve/route'
import { POST as managerReject } from '../../../../src/app/api/manager/expense-notes/[id]/reject/route'
import { GET as managerReceipt } from '../../../../src/app/api/manager/expense-notes/[id]/receipt-url/route'
import { GET as hrList } from '../../../../src/app/api/hr/expense-notes/route'
import { POST as hrApprove } from '../../../../src/app/api/hr/expense-notes/[id]/approve/route'
import { POST as hrReject } from '../../../../src/app/api/hr/expense-notes/[id]/reject/route'
import { GET as hrReceipt } from '../../../../src/app/api/hr/expense-notes/[id]/receipt-url/route'
import { GET as hrUsers } from '../../../../src/app/api/hr/users/route'
import { PUT as assignManager } from '../../../../src/app/api/hr/users/[id]/manager/route'
import { GET as ownReceipt } from '../../../../src/app/api/expense-notes/[id]/receipt-url/route'

const requestId = '11111111-1111-4111-8111-111111111111'
const resourceId = '22222222-2222-4222-8222-222222222222'
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const companyId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
let actorRole = 'manager'
function loginAs(role: string) {
  actorRole = role
  mocks.auth.mockResolvedValue({ user: { id: actorId, role } })
}
function queryWithActor(implementation: (sql: string) => Promise<{ rows: Record<string, unknown>[] }>) {
  mocks.query.mockImplementation((sql: string) => sql.startsWith('SELECT id, company_id, role')
    ? Promise.resolve({ rows: [{ id: actorId, company_id: companyId, is_active: true, role: actorRole }] })
    : implementation(sql))
}

const secret = 'private-sentinel-postgres://password@host/SELECT-token'
const params = () => ({ params: Promise.resolve({ id: resourceId }) })
const request = (body?: string) => new Request('http://localhost/api/test', {
  method: 'PUT', headers: { 'X-Request-Id': requestId }, body,
})
const routes = [
  ['manager list', managerList], ['manager approve', managerApprove], ['manager reject', managerReject],
  ['manager receipt', managerReceipt], ['HR list', hrList], ['HR approve', hrApprove], ['HR reject', hrReject],
  ['HR receipt', hrReceipt], ['HR users', hrUsers], ['assignment', assignManager], ['own receipt', ownReceipt],
] as const
let logs: string[]

beforeEach(() => {
  vi.resetAllMocks()
  globalThis.__pgPool = undefined
  process.env.DATABASE_URL = 'postgres://unused-test-value'
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release })
  queryWithActor(async () => ({ rows: [] }))
  loginAs('manager')
  logs = []
  for (const level of ['info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((value: string) => { logs.push(value) })
  }
})
afterEach(() => vi.restoreAllMocks())

async function expectProblem(response: Response, status: number, code?: string) {
  expect(response.status).toBe(status)
  expect(response.headers.get('content-type')).toBe('application/problem+json')
  const body = await response.json()
  expect(body.status).toBe(status)
  expect(body.error).toBe(body.detail)
  expect(body.requestId).toBe(requestId)
  expect(response.headers.get('x-request-id')).toBe(requestId)
  if (code) expect(body.type).toBe(`urn:expense-io:problem:${code}`)
  expect(JSON.stringify(body) + logs.join()).not.toContain(secret)
  expect(body).not.toHaveProperty('stack')
  expect(JSON.parse(logs.at(-1)!)).toMatchObject({ requestId, status })
}

describe('all Hamza routes use the boundary', () => {
  it.each(routes)('%s requires a session before business data access', async (_label, handler) => {
    mocks.auth.mockResolvedValue(null)
    await expectProblem(await handler(request(), params()), 401, 'unauthenticated')
    expect(mocks.connect).not.toHaveBeenCalled()
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it.each(routes.filter(([label]) => label !== 'own receipt'))('%s distinguishes a forbidden role', async (_label, handler) => {
    loginAs('employee')
    await expectProblem(await handler(request(), params()), 403, 'forbidden')
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('SELECT id, company_id, role'), [actorId])
    expect(mocks.query.mock.calls.some(([sql]) => /UPDATE|expense_notes/.test(sql))).toBe(false)
  })

  it.each(routes)('%s catches asynchronous authentication rejection', async (_label, handler) => {
    mocks.auth.mockRejectedValue(new Error(secret))
    await expectProblem(await handler(request(), params()), 500, 'technical_failure')
  })
})

describe('real route and withUserScope asynchronous boundaries', () => {
  it('catches pool acquisition rejection', async () => {
    mocks.connect.mockRejectedValue(new Error(secret))
    await expectProblem(await managerList(request()), 500)
  })

  it.each(['BEGIN', 'set_config', 'SELECT en.*', 'COMMIT'])('catches %s rejection and releases the client', async (failure) => {
    queryWithActor(async (sql: string) => {
      await Promise.resolve()
      if (sql.includes(failure)) throw new Error(secret)
      return { rows: [] }
    })
    await expectProblem(await managerList(request()), 500)
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK')
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  it('catches rollback failure without revealing either failure', async () => {
    mocks.query.mockRejectedValue(new Error(secret))
    await expectProblem(await managerList(request()), 500)
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  it('catches a directory transaction query failure', async () => {
    loginAs('hr_admin')
    mocks.query.mockRejectedValue(new Error(secret))
    await expectProblem(await hrUsers(request()), 500)
  })

  it.each([['own', ownReceipt, 'employee'], ['manager', managerReceipt, 'manager'], ['HR', hrReceipt, 'hr_admin']] as const)('catches %s receipt presigning failure', async (_name, handler, role) => {
    loginAs(role)
    queryWithActor(async () => ({ rows: [{ receipt_key: 'opaque-receipt' }] }))
    mocks.receipt.mockRejectedValue(new Error(secret))
    await expectProblem(await handler(request(), params()), 500)
  })

  it('catches deferred route params rejection', async () => {
    await expectProblem(await managerApprove(request(), { params: Promise.reject(new Error(secret)) }), 500)
  })

  it('preserves the successful list representation', async () => {
    queryWithActor(async (sql: string) => ({ rows: sql.startsWith('SELECT en.*') ? [{
      id: resourceId, user_id: 'owner', amount: '42.50', expense_date: '2026-10-21',
      description: 'Taxi', receipt_key: 'opaque-key', status: 'pending', created_at: '2026-10-21T10:00:00Z',
    }] : [] }))
    const response = await managerList(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([{
      id: resourceId, userId: 'owner', amount: 42.5, expenseDate: '2026-10-21', description: 'Taxi',
      receiptKey: 'opaque-key', status: 'pending', createdAt: '2026-10-21T10:00:00.000Z',
    }])
  })

  it('uses the same safe 404 for an invisible or missing resource', async () => {
    await expectProblem(await managerApprove(request(), params()), 404, 'not_found')
  })

  it('preserves the already-decided conflict', async () => {
    queryWithActor(async () => ({ rows: [{ status: 'approved' }] }))
    await expectProblem(await managerApprove(request(), params()), 409, 'conflict')
  })
})

describe('manager assignment body errors do not mutate data', () => {
  beforeEach(() => loginAs('hr_admin'))
  it.each(['{', '', 'null', '[]', '42'])('rejects malformed/non-object JSON %s before business data access', async (body) => {
    await expectProblem(await assignManager(request(body), params()), 400, 'invalid_json')
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('SELECT id, company_id, role'), [actorId])
    expect(mocks.query.mock.calls.some(([sql]) => /UPDATE|SELECT id, role/.test(sql))).toBe(false)
  })
  it.each(['{}', '{"managerId":42}', '{"managerId":"password-value"}'])('requires a well-shaped explicit managerId: %s', async (body) => {
    await expectProblem(await assignManager(request(body), params()), 400, 'invalid_manager_assignment')
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('SELECT id, company_id, role'), [actorId])
    expect(mocks.query.mock.calls.some(([sql]) => /UPDATE|SELECT id, role/.test(sql))).toBe(false)
  })
  it.each([null, '33333333-3333-4333-8333-333333333333'])('accepts an explicit valid managerId: %s', async (managerId) => {
    queryWithActor(async (sql: string) => {
      if (sql.startsWith('SELECT id, role')) return { rows: [{ id: resourceId, role: 'employee', is_active: true }, { id: managerId, role: 'manager', is_active: true }] }
      if (sql.startsWith('UPDATE')) return { rows: [{ id: resourceId, name: 'Employee', email: 'employee@example.test', role: 'employee', manager_id: managerId }] }
      return { rows: [{ id: resourceId }] }
    })
    const response = await assignManager(request(JSON.stringify({ managerId })), params())
    expect(response.status).toBe(200)
    expect((await response.json()).managerId).toBe(managerId)
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE users'), [managerId, resourceId, companyId])
  })

  it('catches an asynchronous body stream read failure as a technical error', async () => {
    const incoming = request()
    vi.spyOn(incoming, 'json').mockRejectedValue(new Error(secret))
    await expectProblem(await assignManager(incoming, params()), 500, 'technical_failure')
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('SELECT id, company_id, role'), [actorId])
    expect(mocks.query.mock.calls.some(([sql]) => /UPDATE|SELECT id, role/.test(sql))).toBe(false)
  })
})
