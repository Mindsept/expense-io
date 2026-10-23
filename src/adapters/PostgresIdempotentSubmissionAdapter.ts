import { withCurrentActor } from '@/lib/current-actor'
import { ApiError } from '@/lib/errors'
import type { ExpenseNoteDto } from '@/contracts/expense-note'
import { insertCompleteExpense } from '@/adapters/PostgresExpenseSubmissionAdapter'
import { assertClaimScope, type SubmissionClaim } from '@/adapters/PostgresSubmissionRegistry'
import { ExpensePersistenceFailure, type CompleteExpenseInput, type ExpenseSubmissionPort } from '@/ports/ExpenseSubmissionPort'

export class PostgresIdempotentSubmissionAdapter implements ExpenseSubmissionPort<ExpenseNoteDto> {
  constructor(private readonly claim: SubmissionClaim) {}

  async checkCurrentActor(): Promise<void> {
    await withCurrentActor(undefined, async (client, actor) => {
      assertClaimScope(this.claim, actor)
      const result = await client.query(
        `SELECT id FROM expense_submission_operations WHERE id=$1 AND user_id=$2 AND company_id=$3
         AND state='processing' AND current_attempt_id=$4 AND lease_until > clock_timestamp()`,
        [this.claim.operationId, actor.id, actor.companyId, this.claim.attemptId],
      )
      if (!result.rows[0]) throw new ApiError('idempotency_in_progress')
    })
  }

  async createComplete(input: CompleteExpenseInput): Promise<ExpenseNoteDto> {
    let readyToCommit = false
    try {
      return await withCurrentActor(undefined, async (client, actor) => {
        assertClaimScope(this.claim, actor)
        if (input.receiptKey !== this.claim.receiptKey) throw new Error('Submission receipt reference mismatch')
        const result = await client.query<{ state: string; current_attempt_id: string | null; lease_active: boolean }>(
          `SELECT state,current_attempt_id,lease_until > clock_timestamp() AS lease_active
           FROM expense_submission_operations WHERE id=$1 AND user_id=$2 AND company_id=$3 FOR UPDATE`,
          [this.claim.operationId, actor.id, actor.companyId],
        )
        const row = result.rows[0]
        if (!row || row.state !== 'processing' || row.current_attempt_id !== this.claim.attemptId || !row.lease_active) throw new ApiError('idempotency_in_progress')
        const note = await insertCompleteExpense(client, actor.id, input)
        const saved = await client.query(
          `UPDATE expense_submission_operations SET state='completed',note_id=$2,result=$3::jsonb,
            lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1 AND state='processing'
            AND current_attempt_id=$4 RETURNING id`, [this.claim.operationId, note.id, JSON.stringify(note), this.claim.attemptId],
        )
        if (saved.rows.length !== 1) throw new Error('Submission result was not recorded')
        const committed = await client.query(
          `UPDATE expense_submission_attempts SET state='committed',updated_at=clock_timestamp()
           WHERE operation_id=$1 AND id=$2 AND state='active' RETURNING id`, [this.claim.operationId, this.claim.attemptId],
        )
        if (committed.rows.length !== 1) throw new Error('Submission attempt was not recorded')
        readyToCommit = true
        return note
      })
    } catch (error) {
      throw new ExpensePersistenceFailure(error, readyToCommit ? 'unknown' : 'not_committed')
    }
  }
}
