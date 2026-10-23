import { randomUUID } from 'node:crypto'
import { SubmitExpense } from '@/application/submit-expense'
import { PostgresExpenseSubmissionAdapter } from '@/adapters/PostgresExpenseSubmissionAdapter'
import { S3ReceiptAdapter } from '@/adapters/S3ReceiptAdapter'
import { recordReceiptCleanup } from '@/adapters/ConsoleReceiptCleanup'
import type { ExpenseSubmissionInput } from '@/ports/ExpenseSubmissionPort'

const submission = new SubmitExpense(new PostgresExpenseSubmissionAdapter(), new S3ReceiptAdapter(), randomUUID, recordReceiptCleanup)

export function submitExpenseForCurrentActor(input: ExpenseSubmissionInput, context: { requestId?: string }) {
  return submission.execute(input, context)
}
