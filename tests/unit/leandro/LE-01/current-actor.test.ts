import { readFileSync } from 'node:fs'
import { beforeEach, expect, it, vi } from 'vitest'

// Exercise the real HA-02 contract through Leandro's routes, not a JWT-only stub.
const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn(), upload: vi.fn(), remove: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/db', () => ({ withUserScope: async (_id: string, operation: (client: unknown) => unknown) => operation({ query: mocks.query }) }))
vi.mock('@/lib/storage', () => ({ uploadReceipt: mocks.upload, removeReceipt: mocks.remove, getReceiptUrl: vi.fn() }))
import { GET, POST } from '@/app/api/expense-notes/route'

const id = '11111111-1111-4111-8111-111111111111'
const companyId = '22222222-2222-4222-8222-222222222222'
const actor = { id, company_id: companyId, role: 'employee', is_active: true }
const row = { id: '33333333-3333-4333-8333-333333333333', user_id: id, amount: '12.34', expense_date: '2024-02-29', description: 'Synthetic taxi', receipt_key: '', receipt_seq: 1, status: 'pending', created_at: new Date('2026-10-22T12:00:00Z') }
function submission() {
  const form = new FormData()
  form.set('amount', '12.34'); form.set('expenseDate', '2024-02-29'); form.set('description', 'Synthetic taxi')
  form.set('receipt', new File([readFileSync('tests/fixtures/leandro/LE-01/valid.png')], 'synthetic.png', { type: 'image/png' }))
  return new Request('http://localhost/api/expense-notes', { method: 'POST', body: form })
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ user: { id, companyId: 'untrusted-old-company', role: 'hr_admin' } })
  mocks.query.mockImplementation(async (sql: string, values: unknown[]) => ({ rows: [sql.includes('FROM users') ? actor : { ...row, receipt_key: values[4] }] }))
})

for (const missing of [true, false]) for (const method of ['GET', 'POST']) {
  it(`${method} refuses a ${missing ? 'deleted' : 'disabled'} current actor before expense SQL/storage`, async () => {
    mocks.query.mockResolvedValue({ rows: missing ? [] : [{ ...actor, is_active: false }] })
    const response = await (method === 'GET' ? GET(new Request('http://localhost/api/expense-notes')) : POST(submission()))
    expect(response.status).toBe(401)
    expect(mocks.query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('FROM users'), [id])
    expect(mocks.upload).not.toHaveBeenCalled()
  })
}

it('rechecks the current actor after upload and inserts a complete note exactly once', async () => {
  const response = await POST(submission())
  expect(response.status).toBe(201)
  const note = await response.json()
  expect(mocks.query).toHaveBeenNthCalledWith(1, expect.stringContaining('FROM users'), [id])
  expect(mocks.query).toHaveBeenNthCalledWith(2, expect.stringContaining('FROM users'), [id])
  expect(mocks.query).toHaveBeenNthCalledWith(3, expect.stringContaining('INSERT INTO expense_notes'), [id, '12.34', '2024-02-29', 'Synthetic taxi', note.receiptKey])
  expect(mocks.upload.mock.invocationCallOrder[0]).toBeLessThan(mocks.query.mock.invocationCallOrder[2])
  expect(mocks.upload).toHaveBeenCalledOnce()
  expect(mocks.remove).not.toHaveBeenCalled()
})

it('a now-disabled identity cannot insert after upload, and its uploaded object is compensated', async () => {
  mocks.query.mockResolvedValueOnce({ rows: [actor] }).mockResolvedValueOnce({ rows: [{ ...actor, is_active: false }] })
  const response = await POST(submission())
  expect(response.status).toBe(401)
  expect(mocks.query).toHaveBeenCalledTimes(2)
  expect(mocks.query.mock.calls.some(([sql]) => /INSERT INTO expense_notes|UPDATE expense_notes/.test(String(sql)))).toBe(false)
  expect(mocks.upload).toHaveBeenCalledOnce()
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(mocks.upload.mock.calls[0][0])
})
