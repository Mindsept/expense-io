import type { ReceiptCleanupNotice } from '@/ports/ExpenseSubmissionPort'

/** Collect stdout/stderr operationally. This is not a durable cleanup queue. */
export function recordReceiptCleanup(notice: ReceiptCleanupNotice): void {
  // Only a server-generated opaque reference, allowlisted format/code and a
  // validated correlation ID; never the exception, filename, bytes or signed URL.
  console.error(JSON.stringify(notice))
}
