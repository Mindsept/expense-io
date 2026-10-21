import type { ExpenseNoteStatus } from '@/domain/ExpenseNote'

/** A civil YYYY-MM-DD date, never an instant or a browser-local Date. */
export type CivilDate = string

export interface ExpenseNoteAuthor {
  id: string
  displayName: string
}

/** Current HTTP representation. Optional metadata is supplied only by authorized queries. */
export interface ExpenseNoteDto {
  id: string
  userId: string
  amount: number
  expenseDate: CivilDate
  description: string
  receiptKey: string
  status: ExpenseNoteStatus
  createdAt: string
  author?: ExpenseNoteAuthor
  decidedAt?: string
}
