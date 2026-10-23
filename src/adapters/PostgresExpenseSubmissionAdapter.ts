import { withCurrentActor } from '@/lib/current-actor'
import { toExpenseNote } from '@/adapters/expense-note-mapper'
import type { ExpenseNoteDto } from '@/contracts/expense-note'
import { ExpensePersistenceFailure, type CompleteExpenseInput, type ExpenseSubmissionPort } from '@/ports/ExpenseSubmissionPort'
import type { PoolClient } from 'pg'

/** Shared by plain and idempotent scoped transactions; never commits independently. */
export async function insertCompleteExpense(client: PoolClient, actorId: string, input: CompleteExpenseInput): Promise<ExpenseNoteDto> {
  const result = await client.query(
    `INSERT INTO expense_notes (user_id, amount, expense_date, description, receipt_key)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [actorId, input.amount, input.expenseDate, input.description, input.receiptKey],
  )
  return toExpenseNote(result.rows[0])
}

export class PostgresExpenseSubmissionAdapter implements ExpenseSubmissionPort<ExpenseNoteDto> {
  async checkCurrentActor(): Promise<void> {
    await withCurrentActor(undefined, async () => {})
  }

  async createComplete(input: CompleteExpenseInput): Promise<ExpenseNoteDto> {
    let readyToCommit = false
    try {
      if (!input.receiptKey.trim()) throw new Error('Complete expense requires a receipt reference')
      return await withCurrentActor(undefined, async (client, actor) => {
        // Invalid persisted output must roll back, not return a fabricated DTO.
        const note = await insertCompleteExpense(client, actor.id, input)
        readyToCommit = true
        return note
      })
    } catch (error) {
      // Callback failure means COMMIT was never attempted. Once it returned,
      // withCurrentActor/withUserScope can fail during COMMIT or its acknowledgement.
      throw new ExpensePersistenceFailure(error, readyToCommit ? 'unknown' : 'not_committed')
    }
  }
}
