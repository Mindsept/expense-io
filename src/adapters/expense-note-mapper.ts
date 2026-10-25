import type { ExpenseNoteAuthor, ExpenseNoteDto } from '@/contracts/expense-note'
import { isCivilDate } from '@/utils/validators'

function requiredString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid expense row: expected text')
  return value
}

function timestamp(value: unknown): string {
  // pg returns timestamptz as Date; JSONB rows retain PostgreSQL's microseconds.
  if (!(value instanceof Date) && (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !isCivilDate(value.slice(0, 10)) ||
    Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59
  )) throw new Error('Invalid expense row: expected timestamp')
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid expense row: expected timestamp')
  return date.toISOString()
}

/** Map database values, never raw row spreads. This function grants no authorization. */
export function toExpenseNote(
  row: Record<string, unknown>,
  author?: ExpenseNoteAuthor,
): ExpenseNoteDto {
  const amountText = typeof row.amount === 'number' ? String(row.amount) : row.amount
  if (typeof amountText !== 'string' || !/^\d{1,8}(?:\.\d{1,2})?$/.test(amountText)) {
    throw new Error('Invalid expense row: expected decimal amount')
  }
  const amount = Number(amountText)
  if (amount <= 0 || amount > 99_999_999.99) throw new Error('Invalid expense row: amount out of range')
  if (!isCivilDate(row.expense_date)) throw new Error('Invalid expense row: expected civil date')
  if (row.status !== 'pending' && row.status !== 'approved' && row.status !== 'rejected') {
    throw new Error('Invalid expense row: expected status')
  }
  const dto: ExpenseNoteDto = {
    id: requiredString(row.id),
    userId: requiredString(row.user_id),
    amount,
    expenseDate: row.expense_date,
    description: requiredString(row.description),
    receiptKey: requiredString(row.receipt_key),
    status: row.status,
    createdAt: timestamp(row.created_at),
  }
  if (row.decided_at != null) dto.decidedAt = timestamp(row.decided_at)
  if (author) dto.author = { id: requiredString(author.id), displayName: requiredString(author.displayName) }
  return dto
}
