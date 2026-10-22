import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn(), connect: vi.fn(), release: vi.fn(), receipt: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/storage', () => ({ getReceiptUrl: mocks.receipt }))
vi.mock('pg', () => ({
  Pool: vi.fn(function () { return { connect: mocks.connect } }),
  types: { setTypeParser: vi.fn() },
}))
import { withCurrentActor } from '@/lib/current-actor'
import { GET as ownReceipt } from '@/app/api/expense-notes/[id]/receipt-url/route'
import { GET as managerReceipt } from '@/app/api/manager/expense-notes/[id]/receipt-url/route'
import { PUT as assignManager } from '@/app/api/hr/users/[id]/manager/route'
import { GET as hrReceipt } from '@/app/api/hr/expense-notes/[id]/receipt-url/route'

const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const companyId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const noteId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
let actor: { id: string; company_id: string; role: string; is_active: boolean } | undefined
let receipt: unknown
beforeEach(() => {
  vi.resetAllMocks()
  globalThis.__pgPool = undefined
  process.env.DATABASE_URL = 'postgres://unused-test-value'
  actor = { id: actorId, company_id: companyId, is_active: true, role: 'manager' }
  receipt = 'private/receipt.png'
  mocks.auth.mockResolvedValue({ user: { id: actorId, role: 'employee', companyId: 'untrusted-company' } })
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release })
  mocks.query.mockImplementation(async (sql: string) => ({
    rows: sql.startsWith('SELECT id, company_id, role') ? (actor ? [actor] : [])
      : sql.includes('receipt_key') ? [{ receipt_key: receipt }] : [],
  }))
  mocks.receipt.mockResolvedValue('https://storage.example.test/signed')
  for (const level of ['info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('current database identity is the authorization authority', () => {
  it('ignores stale JWT role/company and exposes an immutable current actor in the scoped transaction', async () => {
    const result = await withCurrentActor('manager', async (client, current) => {
      expect(current).toEqual({ id: actorId, companyId, role: 'manager' })
      expect(Object.isFrozen(current)).toBe(true)
      await client.query('SELECT authorized-work')
      return 'done'
    })
    expect(result).toBe('done')
    expect(mocks.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN', "SELECT set_config('app.current_user_id', $1, true)",
      'SELECT id, company_id, role, is_active FROM users WHERE id = $1 FOR SHARE', 'SELECT authorized-work', 'COMMIT',
    ])
    expect(mocks.release).toHaveBeenCalledOnce()
  })
  it.each([null, {}, { user: {} }, { user: { id: 'invalid' } }])('rejects an absent or invalid authenticated identity: %j', async (session) => {
    mocks.auth.mockResolvedValue(session)
    await expect(withCurrentActor(undefined, vi.fn())).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(mocks.connect).not.toHaveBeenCalled()
  })
  it('rejects a deleted user even while their signed session exists', async () => {
    actor = undefined
    const operation = vi.fn()
    await expect(withCurrentActor(undefined, operation)).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(operation).not.toHaveBeenCalled()
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK')
    expect(mocks.release).toHaveBeenCalledOnce()
  })
  it('rejects a disabled database actor even if a caller supplies a stale session', async () => {
    actor!.is_active = false
    const operation = vi.fn()
    await expect(withCurrentActor(undefined, operation)).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(operation).not.toHaveBeenCalled()
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK')
  })
  it('rejects the next request after role revocation despite the old privileged JWT', async () => {
    mocks.auth.mockResolvedValue({ user: { id: actorId, role: 'manager' } })
    actor!.role = 'employee'
    const operation = vi.fn()
    await expect(withCurrentActor('manager', operation)).rejects.toMatchObject({ code: 'forbidden' })
    expect(operation).not.toHaveBeenCalled()
  })
  it.each(['employee', 'manager', 'hr_admin'])('supports personal operations for current %s', async (role) => {
    actor!.role = role
    await expect(withCurrentActor(undefined, async (_client, current) => current.role)).resolves.toBe(role)
  })
  it('fails closed for a database role outside the supported model', async () => {
    actor!.role = 'superadmin'
    await expect(withCurrentActor(undefined, vi.fn())).rejects.toMatchObject({ code: 'forbidden' })
  })
  it('rolls back an operation failure and releases the connection', async () => {
    await expect(withCurrentActor('manager', async () => { throw new Error('operation failed') })).rejects.toThrow('operation failed')
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK')
    expect(mocks.release).toHaveBeenCalledOnce()
  })
})

for (const [label, handler, role] of [
  ['personal', ownReceipt, 'employee'], ['manager', managerReceipt, 'manager'], ['HR', hrReceipt, 'hr_admin'],
] as const) {
  describe(`${label} receipt`, () => {
    it.each(['', '  \t', null, undefined])('never signs an empty or missing key: %j', async (key) => {
      actor!.role = role
      receipt = key
      const response = await handler(new Request('http://localhost/receipt'), { params: Promise.resolve({ id: noteId }) })
      expect(response.status).toBe(404)
      expect(mocks.receipt).not.toHaveBeenCalled()
      expect(mocks.query).toHaveBeenCalledWith('ROLLBACK')
    })
    it('never signs when the scoped query returns no visible note', async () => {
      actor!.role = role
      mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith('SELECT id, company_id, role') ? [actor] : [] }))
      const response = await handler(new Request('http://localhost/receipt'), { params: Promise.resolve({ id: noteId }) })
      expect(response.status).toBe(404)
      expect(mocks.receipt).not.toHaveBeenCalled()
    })
    it('signs an authorized opaque key and preserves the response DTO', async () => {
      actor!.role = role
      const response = await handler(new Request('http://localhost/receipt'), { params: Promise.resolve({ id: noteId }) })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ url: 'https://storage.example.test/signed' })
      expect(mocks.receipt).toHaveBeenCalledExactlyOnceWith('private/receipt.png')
      expect(mocks.query).toHaveBeenLastCalledWith('COMMIT')
    })
  })
}

it('holds no database transaction while an assignment body is still streaming, then checks current rights', async () => {
  actor!.role = 'hr_admin'
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
  const incoming = new Request('http://localhost/assignment', {
    method: 'PUT', body: stream, duplex: 'half',
  } as RequestInit)
  const pending = assignManager(incoming, { params: Promise.resolve({ id: noteId }) })
  controller.enqueue(new TextEncoder().encode('{"managerId":'))
  await new Promise((resolve) => setImmediate(resolve))
  expect(mocks.connect).not.toHaveBeenCalled()
  expect(mocks.query).not.toHaveBeenCalled()
  actor!.role = 'employee'
  controller.enqueue(new TextEncoder().encode('null}'))
  controller.close()
  const response = await pending
  expect(response.status).toBe(403)
  expect(mocks.query.mock.calls.some(([sql]) => /UPDATE|SELECT id, role/.test(sql))).toBe(false)
})
