import { measurePhase } from '@/observability/diagnostics'
import type { ReceiptStoragePort } from '@/ports/ReceiptStoragePort'
import { ExpensePersistenceFailure, type ExpenseSubmissionInput, type ExpenseSubmissionPort, type ReceiptCleanupNotice, type ReceiptCleanupReporter } from '@/ports/ExpenseSubmissionPort'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const extensions = new Set(['.png', '.jpg', '.webp', '.pdf'])

/** No SQL transaction is held while either storage operation runs. */
export class SubmitExpense<T> {
  constructor(
    private readonly expenses: ExpenseSubmissionPort<T>,
    private readonly receipts: ReceiptStoragePort,
    private readonly nextReceiptRef: () => string,
    private readonly reportCleanup: ReceiptCleanupReporter,
  ) {}

  async execute(input: ExpenseSubmissionInput, context: { requestId?: string } = {}): Promise<T> {
    await this.expenses.checkCurrentActor()
    const receiptRef = this.nextReceiptRef()
    if (!uuid.test(receiptRef) || !extensions.has(input.extension)) throw new Error('Invalid generated receipt reference')
    const key = `receipts/${receiptRef}${input.extension}`
    const requestId = context.requestId && uuid.test(context.requestId) ? context.requestId.toLowerCase() : undefined
    const notice = (code: ReceiptCleanupNotice['code']) => {
      try {
        void Promise.resolve(this.reportCleanup(Object.freeze({ operation: 'expense.submit.cleanup', code, receiptRef, extension: input.extension, ...(requestId ? { requestId } : {}) }))).catch(() => {})
      } catch { /* A diagnostic transport failure cannot replace the submission error. */ }
    }
    let persistenceStarted = false
    try {
      await measurePhase('storage.upload', context, () => this.receipts.upload(key, input.buffer, input.mimeType), () => 'success', () => 'storage_upload_failed')
      persistenceStarted = true
      return await measurePhase('expense.persist', context, () => this.expenses.createComplete({ amount: input.amount, expenseDate: input.expenseDate, description: input.description, receiptKey: key }), () => 'success', error => error instanceof ExpensePersistenceFailure && error.outcome === 'not_committed' ? 'persist_not_committed' : 'persist_commit_unknown')
    } catch (error) {
      const uncertainCommit = persistenceStarted && (!(error instanceof ExpensePersistenceFailure) || error.outcome === 'unknown')
      if (uncertainCommit) {
        // Deleting here could turn a committed complete note into a broken note.
        // LE-03/operator reconciliation must first check the database reference.
        notice('commit_unconfirmed')
      } else {
        try { await measurePhase('storage.remove', context, () => this.receipts.remove(key), () => 'success', () => 'storage_delete_failed') }
        catch { notice('cleanup_failed') }
        // A failed upload acknowledgement can leave a late-arriving object even
        // after a successful delete. Record its reference for later reconciliation.
        if (!persistenceStarted) notice('upload_unconfirmed')
      }
      throw error instanceof ExpensePersistenceFailure ? error.failure : error
    }
  }
}
