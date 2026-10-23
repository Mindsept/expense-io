import { SubmitExpense } from '@/application/submit-expense'
import { PostgresSubmissionRegistry } from '@/adapters/PostgresSubmissionRegistry'
import { PostgresIdempotentSubmissionAdapter } from '@/adapters/PostgresIdempotentSubmissionAdapter'
import { S3ReceiptAdapter } from '@/adapters/S3ReceiptAdapter'
import { recordReceiptCleanup } from '@/adapters/ConsoleReceiptCleanup'
import { submissionFingerprint } from '@/lib/submission-intent'
import type { ExpenseSubmissionInput } from '@/ports/ExpenseSubmissionPort'

const registry = new PostgresSubmissionRegistry()
const receipts = new S3ReceiptAdapter()

export async function submitIdempotentExpense(input: ExpenseSubmissionInput, key: string, context: { requestId: string }) {
  const reservation = await registry.reserve(key, submissionFingerprint(input), input.extension)
  if (reservation.kind === 'replay') return { expense: reservation.expense, replayed: true }
  const { claim } = reservation
  const submission = new SubmitExpense(new PostgresIdempotentSubmissionAdapter(claim), receipts, () => claim.attemptId, recordReceiptCleanup)
  try {
    return { expense: await submission.execute(input, context), replayed: false }
  } catch (error) {
    try { await registry.retireFailedAttempt(claim) }
    catch {
      // The attempt/reference was durable before PUT; maintenance can reconcile
      // it even when the actor has since been revoked or metadata is unavailable.
      try { recordReceiptCleanup({ operation: 'expense.submit.cleanup', code: 'operation_state_unconfirmed', receiptRef: claim.attemptId, extension: input.extension, requestId: context.requestId }) } catch {}
    }
    throw error
  }
}
