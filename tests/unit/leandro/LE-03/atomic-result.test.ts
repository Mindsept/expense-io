import { beforeEach, expect, it, vi } from 'vitest'
import { ExpensePersistenceFailure } from '@/ports/ExpenseSubmissionPort'

const mocks = vi.hoisted(() => ({ scope: vi.fn(), query: vi.fn(), commitError: undefined as Error | undefined, state: {} as Record<string, unknown> }))
vi.mock('@/lib/current-actor', () => ({ withCurrentActor: mocks.scope }))
import { PostgresIdempotentSubmissionAdapter } from '@/adapters/PostgresIdempotentSubmissionAdapter'
const actor = { id: '11111111-1111-4111-8111-111111111111', companyId: '22222222-2222-4222-8222-222222222222', role: 'employee' }
const claim = { operationId: '33333333-3333-4333-8333-333333333333', attemptId: '44444444-4444-4444-8444-444444444444', userId: actor.id, companyId: actor.companyId, receiptKey: 'receipts/44444444-4444-4444-8444-444444444444.png' }
const input = { amount: '12.34', expenseDate: '2024-02-29', description: 'Synthetic', receiptKey: claim.receiptKey }
const row = { id: '55555555-5555-4555-8555-555555555555', user_id: actor.id, amount: '12.34', expense_date: input.expenseDate, description: input.description, receipt_key: input.receiptKey, status: 'pending', created_at: new Date('2026-10-23T10:00:00Z') }
const adapter = new PostgresIdempotentSubmissionAdapter(claim)
beforeEach(() => {
  vi.resetAllMocks(); mocks.commitError = undefined
  mocks.state = { state: 'processing', current_attempt_id: claim.attemptId, lease_active: true }
  mocks.scope.mockImplementation(async (_role, operation) => { const result = await operation({ query: mocks.query }, actor); if (mocks.commitError) throw mocks.commitError; return result })
  mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('SELECT state') ? [mocks.state] : sql.includes('INSERT INTO expense_notes') ? [row] : [{ id: claim.operationId }] }))
})
it('note, cached response and committed attempt share exactly one scope/commit boundary', async () => {
  const result = await adapter.createComplete(input)
  expect(mocks.scope).toHaveBeenCalledOnce()
  expect(mocks.query).toHaveBeenNthCalledWith(1, expect.stringContaining('FOR UPDATE'), [claim.operationId, actor.id, actor.companyId])
  expect(mocks.query).toHaveBeenNthCalledWith(2, expect.stringContaining('INSERT INTO expense_notes'), [actor.id, '12.34', '2024-02-29', 'Synthetic', input.receiptKey])
  expect(mocks.query).toHaveBeenNthCalledWith(3, expect.stringContaining("state='completed'"), [claim.operationId, row.id, JSON.stringify(result), claim.attemptId])
  expect(mocks.query).toHaveBeenNthCalledWith(4, expect.stringContaining("state='committed'"), [claim.operationId, claim.attemptId])
})
it.each([{ state: 'completed' }, { current_attempt_id: 'newer-attempt' }, { lease_active: false }])('a fenced or expired attempt cannot insert a note: %j', async change => {
  Object.assign(mocks.state, change)
  const error = await adapter.createComplete(input).catch(error => error)
  expect(error).toBeInstanceOf(ExpensePersistenceFailure)
  expect(error.outcome).toBe('not_committed')
  expect(error.failure).toMatchObject({ code: 'idempotency_in_progress' })
  expect(mocks.query).toHaveBeenCalledOnce()
})
it.each(['expense_submission_operations', 'expense_submission_attempts'])('a denied/no-row update to %s cannot commit an uncached or unrecorded note', async table => {
  mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('SELECT state') ? [mocks.state] : sql.includes('INSERT INTO expense_notes') ? [row] : sql.includes(`UPDATE ${table}`) ? [] : [{ id: claim.operationId }] }))
  const error = await adapter.createComplete(input).catch(error => error)
  expect(error).toBeInstanceOf(ExpensePersistenceFailure)
  expect(error.outcome).toBe('not_committed')
})
it('a lost commit acknowledgement is uncertain, never a safe-delete instruction', async () => {
  mocks.commitError = new Error('COMMIT ack lost')
  const error = await adapter.createComplete(input).catch(error => error)
  expect(error.outcome).toBe('unknown')
  expect(error.failure).toBe(mocks.commitError)
})
