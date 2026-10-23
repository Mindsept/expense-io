import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/errors'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), actor: vi.fn(), scoped: vi.fn(), query: vi.fn(), upload: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/current-actor', () => ({ withCurrentActor: mocks.actor }))
vi.mock('@/lib/db', () => ({
  withUserScope: mocks.scoped,
  getPool: () => ({ query: mocks.query }),
}))
vi.mock('@/lib/storage', () => ({ receiptKeyFor: () => 'receipts/1.png', uploadReceipt: mocks.upload }))
import { GET, POST } from '@/app/api/expense-notes/route'

const row = { id: 'note', user_id: 'owner', receipt_seq: 1, amount: '12.34', expense_date: '2024-02-29',
  description: 'Synthetic taxi', receipt_key: 'receipts/1.png', status: 'pending', created_at: new Date('2026-10-22T12:00:00Z') }
const png = readFileSync('tests/fixtures/leandro/LE-04/images/large-total.png')
const requestId = '11111111-1111-4111-8111-111111111111'

function submission(overrides: Record<string, string | Blob> = {}) {
  const form = new FormData()
  for (const [name, value] of Object.entries({ amount: '12.34', expenseDate: '2024-02-29', description: 'Synthetic taxi',
    receipt: new File([png], 'synthetic.png', { type: 'image/png' }), ...overrides })) form.set(name, value)
  return new NextRequest('http://localhost/api/expense-notes', { method: 'POST', body: form, headers: { 'X-Request-Id': requestId } })
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ user: { id: 'owner', role: 'employee' } })
  mocks.scoped.mockImplementation(async (_id, operation) => operation({ query: mocks.query }))
  mocks.actor.mockImplementation(async (_role, operation) => {
    const session = await mocks.auth()
    if (!session?.user) throw new ApiError('unauthenticated')
    return mocks.scoped(session.user.id, (client: unknown) => operation(client, { id: session.user.id, companyId: 'company', role: session.user.role }))
  })
  mocks.query.mockResolvedValue({ rows: [row] })
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

async function invalid(response: Response) {
  expect(response.status).toBe(400)
  expect(response.headers.get('content-type')).toBe('application/problem+json')
  const body = await response.json()
  expect(body).toMatchObject({ status: 400, error: expect.any(String), requestId })
  expect(body.error).toBe(body.detail)
  expect(response.headers.get('x-request-id')).toBe(requestId)
  expect(mocks.query).not.toHaveBeenCalled()
  expect(mocks.upload).not.toHaveBeenCalled()
}

it.each(['constructor', '__proto__', 'unknown', 'created_at DESC; SELECT 1', 'amount desc --'])('rejects sort %s before SQL', async sort => {
  await invalid(await GET(new NextRequest(`http://localhost/api/expense-notes?sort=${encodeURIComponent(sort)}`, { headers: { 'X-Request-Id': requestId } })))
})

it.each(['12.34garbage', 'NaN', 'Infinity', '1e2', '12.345', '100000000', '0', '-1', ' 12.34', '12,34'])('rejects amount %s before DB/storage', async amount => {
  await invalid(await POST(submission({ amount })))
})

it.each(['2023-02-29', '2026-04-31', '2026-13-01', '0000-01-01', '2026-1-1'])('rejects impossible/non-civil date %s', async expenseDate => {
  await invalid(await POST(submission({ expenseDate })))
})

it.each(['', '   ', 'x'.repeat(4001), 'Taxi\u0000private'])('rejects an invalid description', async description => {
  await invalid(await POST(submission({ description })))
})

it.each([
  new File([], 'empty.png', { type: 'image/png' }),
  new File(['ordinary text'], 'spoof.png', { type: 'image/png' }),
  new File([png], 'spoof.pdf', { type: 'application/pdf' }),
])('rejects an empty or MIME-spoofed receipt before any write', async receipt => {
  await invalid(await POST(submission({ receipt })))
})

it('preserves a valid multipart POST with a real PNG', async () => {
  const response = await POST(submission())
  expect(response.status).toBe(201)
  expect((await response.json()).amount).toBe(12.34)
  expect(mocks.upload).toHaveBeenCalledWith('receipts/1.png', png, 'image/png')
})

it.each(['created_at DESC', 'created_at ASC', 'amount DESC', 'amount ASC', 'expense_date DESC', 'expense_date ASC'])('preserves the historical safe sort %s', async sort => {
  const response = await GET(new NextRequest(`http://localhost/api/expense-notes?sort=${encodeURIComponent(sort)}`))
  expect(response.status).toBe(200)
  expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining(`ORDER BY ${sort}`), ['owner'])
})

it.each([GET, POST])('requires authentication before parsing or DB access', async handler => {
  mocks.auth.mockResolvedValue(null)
  const response = await handler(submission())
  expect(response.status).toBe(401)
  expect((await response.json()).requestId).toBe(requestId)
  expect(mocks.scoped).not.toHaveBeenCalled()
  expect(mocks.upload).not.toHaveBeenCalled()
})

it('catches a transaction/commit rejection without leaking its cause', async () => {
  mocks.scoped.mockRejectedValue(new Error('private-sql-database-password'))
  const response = await GET(new NextRequest('http://localhost/api/expense-notes', { headers: { 'X-Request-Id': requestId } }))
  expect(response.status).toBe(500)
  expect(await response.text()).not.toContain('private-sql')
})

it('rejects malformed multipart inside the shared error contract', async () => {
  await invalid(await POST(new NextRequest('http://localhost/api/expense-notes', {
    method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=missing', 'X-Request-Id': requestId }, body: 'broken',
  })))
})
