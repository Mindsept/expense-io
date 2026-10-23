export type ReceiptExtension = '.png' | '.jpg' | '.webp' | '.pdf'

/** Input has already passed the owned amount/date/description/container validators. */
export interface ExpenseSubmissionInput {
  amount: string
  expenseDate: string
  description: string
  buffer: Buffer
  mimeType: string
  extension: ReceiptExtension
}

export interface CompleteExpenseInput {
  amount: string
  expenseDate: string
  description: string
  receiptKey: string
}

export interface ExpenseSubmissionPort<T> {
  checkCurrentActor(): Promise<void>
  createComplete(input: CompleteExpenseInput): Promise<T>
}

/** An uncertain COMMIT must never trigger deletion of a possibly referenced object. */
export class ExpensePersistenceFailure extends Error {
  constructor(readonly failure: unknown, readonly outcome: 'not_committed' | 'unknown') {
    super('Expense persistence failed', { cause: failure })
  }
}

export type ReceiptCleanupNotice = Readonly<{
  operation: 'expense.submit.cleanup'
  code: 'cleanup_failed' | 'upload_unconfirmed' | 'commit_unconfirmed'
  receiptRef: string
  extension: ReceiptExtension
  requestId?: string
}>
export type ReceiptCleanupReporter = (notice: ReceiptCleanupNotice) => void | Promise<void>
