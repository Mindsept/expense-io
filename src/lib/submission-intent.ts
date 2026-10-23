import { createHash } from 'node:crypto'
import { ApiError } from '@/lib/errors'
import type { ExpenseSubmissionInput } from '@/ports/ExpenseSubmissionPort'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function submissionIntentKey(headers: Headers): string | undefined {
  const value = headers.get('idempotency-key')
  if (value === null) return undefined
  if (!uuid.test(value)) throw new ApiError('validation')
  return value.toLowerCase()
}

/** Versioned canonical fields + exact receipt bytes; filename is not business input. */
export function submissionFingerprint(input: ExpenseSubmissionInput): string {
  const [integer, fraction = ''] = input.amount.split('.')
  const amount = `${integer.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(2, '0')}`
  const contentHash = createHash('sha256').update(input.buffer).digest('hex')
  return createHash('sha256').update(JSON.stringify(['expense.create.v1', amount, input.expenseDate, input.description, input.mimeType, input.buffer.length, contentHash])).digest('hex')
}
