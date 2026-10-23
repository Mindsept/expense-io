import { beforeEach, expect, it, vi } from 'vitest'
import { ExpensePersistenceFailure } from '@/ports/ExpenseSubmissionPort'

const mocks = vi.hoisted(() => ({ scope: vi.fn(), query: vi.fn(), commitError: undefined as Error | undefined }))
vi.mock('@/lib/current-actor', () => ({ withCurrentActor: mocks.scope }))
import { PostgresExpenseSubmissionAdapter } from '@/adapters/PostgresExpenseSubmissionAdapter'
const adapter = new PostgresExpenseSubmissionAdapter()
const actor = { id: '11111111-1111-4111-8111-111111111111', companyId: 'current-company', role: 'employee' }
const input = { amount: '12.34', expenseDate: '2024-02-29', description: 'Synthetic taxi', receiptKey: 'receipts/22222222-2222-4222-8222-222222222222.png' }
const row = { id: '33333333-3333-4333-8333-333333333333', user_id: actor.id, amount: '12.34', expense_date: input.expenseDate, description: input.description, receipt_key: input.receiptKey, status: 'pending', created_at: new Date('2026-10-23T10:00:00Z'), password_hash: 'private' }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.commitError = undefined
  mocks.scope.mockImplementation(async (_role, operation) => {
    const result = await operation({ query: mocks.query }, actor)
    if (mocks.commitError) throw mocks.commitError
    return result
  })
  mocks.query.mockResolvedValue({ rows: [row] })
})

it('authority preflight opens only the existing current-actor scope, without expense SQL', async () => {
  await adapter.checkCurrentActor()
  expect(mocks.scope).toHaveBeenCalledExactlyOnceWith(undefined, expect.any(Function))
  expect(mocks.query).not.toHaveBeenCalled()
})

it('the complete persistence boundary cannot insert an empty receipt reference', async () => {
  const error = await adapter.createComplete({ ...input, receiptKey: '  ' }).catch(error => error)
  expect(error).toBeInstanceOf(ExpensePersistenceFailure)
  expect(error.outcome).toBe('not_committed')
  expect(mocks.scope).not.toHaveBeenCalled()
  expect(mocks.query).not.toHaveBeenCalled()
})

it('inserts complete metadata under the current actor and runs the real shared mapper before commit', async () => {
  const result = await adapter.createComplete(input)
  expect(mocks.query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('INSERT INTO expense_notes'), [actor.id, '12.34', '2024-02-29', 'Synthetic taxi', input.receiptKey])
  expect(result).toEqual({ id: row.id, userId: actor.id, amount: 12.34, expenseDate: input.expenseDate, description: input.description, receiptKey: input.receiptKey, status: 'pending', createdAt: '2026-10-23T10:00:00.000Z' })
})

it.each(['actor', 'insert', 'mapper'])('classifies %s failure before callback completion as not committed', async phase => {
  const failure = new Error('private-database-detail')
  if (phase === 'actor') mocks.scope.mockRejectedValue(failure)
  if (phase === 'insert') mocks.query.mockRejectedValue(failure)
  if (phase === 'mapper') mocks.query.mockResolvedValue({ rows: [{ ...row, expense_date: 'invalid' }] })
  const error = await adapter.createComplete(input).catch(error => error)
  expect(error).toBeInstanceOf(ExpensePersistenceFailure)
  expect(error.outcome).toBe('not_committed')
  if (phase !== 'mapper') expect(error.failure).toBe(failure)
})

it('preserves an uncertain commit outcome after the complete callback instead of permitting destructive compensation', async () => {
  mocks.commitError = new Error('COMMIT acknowledgement lost')
  const error = await adapter.createComplete(input).catch(error => error)
  expect(error).toBeInstanceOf(ExpensePersistenceFailure)
  expect(error.outcome).toBe('unknown')
  expect(error.failure).toBe(mocks.commitError)
  expect(mocks.query).toHaveBeenCalledOnce()
})
