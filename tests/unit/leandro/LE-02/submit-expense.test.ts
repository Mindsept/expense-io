import { beforeEach, expect, it, vi } from 'vitest'
import { SubmitExpense } from '@/application/submit-expense'
import { ExpensePersistenceFailure, type ExpenseSubmissionInput, type ReceiptCleanupReporter } from '@/ports/ExpenseSubmissionPort'

const receiptRef = '11111111-1111-4111-8111-111111111111'
const requestId = '22222222-2222-4222-8222-222222222222'
const key = `receipts/${receiptRef}.png`
const input: ExpenseSubmissionInput = { amount: '12.34', expenseDate: '2024-02-29', description: 'Synthetic taxi', buffer: Buffer.from('validated synthetic bytes'), mimeType: 'image/png', extension: '.png' }
const expenses = { checkCurrentActor: vi.fn(), createComplete: vi.fn() }
const receipts = { upload: vi.fn(), remove: vi.fn(), getSignedUrl: vi.fn() }
const report = vi.fn()
const reference = vi.fn()
const service = () => new SubmitExpense(expenses, receipts, reference, report)
const failure = new Error('private-sql-password-receipt-name')
beforeEach(() => {
  vi.resetAllMocks()
  reference.mockReturnValue(receiptRef)
  expenses.createComplete.mockResolvedValue({ id: 'synthetic-note', receiptKey: key })
})

it('checks current authority, uploads, then creates exactly one complete note; never exposes an empty-key insert', async () => {
  const order: string[] = []
  expenses.checkCurrentActor.mockImplementation(async () => { order.push('actor') })
  receipts.upload.mockImplementation(async () => { order.push('upload') })
  expenses.createComplete.mockImplementation(async value => { order.push('create'); return value })
  const result = await service().execute(input, { requestId })
  expect(order).toEqual(['actor', 'upload', 'create'])
  expect(result).toEqual({ amount: '12.34', expenseDate: '2024-02-29', description: 'Synthetic taxi', receiptKey: key })
  expect(receipts.upload).toHaveBeenCalledExactlyOnceWith(key, input.buffer, 'image/png')
  expect(expenses.createComplete).toHaveBeenCalledOnce()
  expect(receipts.remove).not.toHaveBeenCalled()
  expect(report).not.toHaveBeenCalled()
})

it('denied current authority cannot start storage or expense persistence', async () => {
  expenses.checkCurrentActor.mockRejectedValue(failure)
  await expect(service().execute(input)).rejects.toBe(failure)
  expect(reference).not.toHaveBeenCalled()
  expect(receipts.upload).not.toHaveBeenCalled()
  expect(receipts.remove).not.toHaveBeenCalled()
  expect(expenses.createComplete).not.toHaveBeenCalled()
})

it('invalid generated reference fails before upload', async () => {
  reference.mockReturnValue('../private')
  await expect(service().execute(input)).rejects.toThrow('Invalid generated receipt reference')
  expect(receipts.upload).not.toHaveBeenCalled()
  expect(expenses.createComplete).not.toHaveBeenCalled()
})

it('upload failure creates no note, attempts cleanup and records the unconfirmed upload without leaking its cause', async () => {
  receipts.upload.mockRejectedValue(failure)
  await expect(service().execute(input, { requestId })).rejects.toBe(failure)
  expect(expenses.createComplete).not.toHaveBeenCalled()
  expect(receipts.remove).toHaveBeenCalledExactlyOnceWith(key)
  expect(report).toHaveBeenCalledExactlyOnceWith({ operation: 'expense.submit.cleanup', code: 'upload_unconfirmed', receiptRef, extension: '.png', requestId })
  expect(JSON.stringify(report.mock.calls)).not.toContain('private')
})

it('known insertion failure compensates the uploaded object and preserves the original failure', async () => {
  expenses.createComplete.mockRejectedValue(new ExpensePersistenceFailure(failure, 'not_committed'))
  await expect(service().execute(input)).rejects.toBe(failure)
  expect(receipts.remove).toHaveBeenCalledExactlyOnceWith(key)
  expect(report).not.toHaveBeenCalled()
})

it('failed compensation keeps an exploitable opaque cleanup reference and the primary failure', async () => {
  expenses.createComplete.mockRejectedValue(new ExpensePersistenceFailure(failure, 'not_committed'))
  receipts.remove.mockRejectedValue(new Error('signed-url-and-delete-secret'))
  await expect(service().execute(input, { requestId })).rejects.toBe(failure)
  expect(report).toHaveBeenCalledExactlyOnceWith({ operation: 'expense.submit.cleanup', code: 'cleanup_failed', receiptRef, extension: '.png', requestId })
  expect(Object.isFrozen(report.mock.calls[0][0])).toBe(true)
  expect(JSON.stringify(report.mock.calls)).not.toMatch(/private|signed-url|delete-secret|Synthetic taxi/)
})

it('failed upload plus failed delete records both bounded categories, not raw exceptions', async () => {
  receipts.upload.mockRejectedValue(failure)
  receipts.remove.mockRejectedValue(new Error('private-delete'))
  await expect(service().execute(input, { requestId: 'invalid-header-secret' })).rejects.toBe(failure)
  expect(report.mock.calls.map(([notice]) => notice.code)).toEqual(['cleanup_failed', 'upload_unconfirmed'])
  expect(report.mock.calls.every(([notice]) => !('requestId' in notice))).toBe(true)
  expect(JSON.stringify(report.mock.calls)).not.toMatch(/private|invalid-header-secret/)
})

it.each(['typed', 'unexpected'])('uncertain commit (%s) cannot delete a potentially committed note receipt', async kind => {
  expenses.createComplete.mockRejectedValue(kind === 'typed' ? new ExpensePersistenceFailure(failure, 'unknown') : failure)
  await expect(service().execute(input, { requestId })).rejects.toBe(failure)
  expect(receipts.remove).not.toHaveBeenCalled()
  expect(report).toHaveBeenCalledExactlyOnceWith({ operation: 'expense.submit.cleanup', code: 'commit_unconfirmed', receiptRef, extension: '.png', requestId })
})

it.each(['throw', 'reject', 'pending'])('a %s diagnostic transport cannot replace or delay the primary failure', async mode => {
  expenses.createComplete.mockRejectedValue(new ExpensePersistenceFailure(failure, 'not_committed'))
  receipts.remove.mockRejectedValue(new Error('delete failed'))
  const reporter: ReceiptCleanupReporter = mode === 'throw' ? () => { throw new Error('collector') }
    : mode === 'reject' ? () => Promise.reject(new Error('collector')) : () => new Promise(() => {})
  const submission = new SubmitExpense(expenses, receipts, reference, reporter)
  await expect(submission.execute(input)).rejects.toBe(failure)
})

it('concurrent executions keep distinct receipt references; one rollback never deletes the successful receipt', async () => {
  const otherRef = '33333333-3333-4333-8333-333333333333'
  reference.mockReturnValueOnce(receiptRef).mockReturnValueOnce(otherRef)
  const objects = new Set<string>()
  receipts.upload.mockImplementation(async (objectKey: string) => { objects.add(objectKey) })
  receipts.remove.mockImplementation(async (objectKey: string) => { objects.delete(objectKey) })
  expenses.createComplete.mockImplementation(async value => {
    if (value.description === 'Fail this one') throw new ExpensePersistenceFailure(failure, 'not_committed')
    return value
  })
  const submission = service()
  const result = await Promise.allSettled([submission.execute({ ...input, description: 'Fail this one' }), submission.execute(input)])
  expect(result.map(item => item.status)).toEqual(['rejected', 'fulfilled'])
  expect([...objects]).toEqual([`receipts/${otherRef}.png`])
  expect(receipts.remove).toHaveBeenCalledExactlyOnceWith(key)
})
