import { randomUUID } from 'node:crypto'
import { withCurrentActor, type CurrentActor } from '@/lib/current-actor'
import { ApiError } from '@/lib/errors'
import { toExpenseNote } from '@/adapters/expense-note-mapper'
import type { ExpenseNoteDto } from '@/contracts/expense-note'
import type { ReceiptExtension } from '@/ports/ExpenseSubmissionPort'

export type SubmissionClaim = Readonly<{ operationId: string; attemptId: string; userId: string; companyId: string; receiptKey: string }>
export type SubmissionReservation = { kind: 'replay'; expense: ExpenseNoteDto } | { kind: 'attempt'; claim: SubmissionClaim }
interface OperationRow {
  id: string
  fingerprint: string
  state: 'processing' | 'failed' | 'completed'
  current_attempt_id: string | null
  note_id: string | null
  result: unknown
  expired: boolean
  lease_active: boolean
}

export function assertClaimScope(claim: SubmissionClaim, actor: CurrentActor): void {
  if (claim.userId !== actor.id || claim.companyId !== actor.companyId) throw new ApiError('not_found')
}

function replayDto(value: unknown, actorId: string, noteId: string): ExpenseNoteDto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stored submission result')
  const result = value as Record<string, unknown>
  const note = toExpenseNote({ id: result.id, user_id: result.userId, amount: result.amount, expense_date: result.expenseDate, description: result.description, receipt_key: result.receiptKey, status: result.status, created_at: result.createdAt })
  if (note.id !== noteId || note.userId !== actorId) throw new Error('Inconsistent stored submission result')
  return note
}

export class PostgresSubmissionRegistry {
  async reserve(key: string, fingerprint: string, extension: ReceiptExtension): Promise<SubmissionReservation> {
    return withCurrentActor(undefined, async (client, actor) => {
      await client.query(
        `INSERT INTO expense_submission_operations (user_id,company_id,intent_key,fingerprint)
         VALUES ($1,$2,$3,$4) ON CONFLICT (user_id,company_id,operation,intent_key) DO NOTHING`,
        [actor.id, actor.companyId, key, fingerprint],
      )
      const result = await client.query<OperationRow>(
        `SELECT *, expires_at <= clock_timestamp() AS expired,
          lease_until > clock_timestamp() AS lease_active
         FROM expense_submission_operations
         WHERE user_id=$1 AND company_id=$2 AND operation='expense.create' AND intent_key=$3
         FOR UPDATE`, [actor.id, actor.companyId, key],
      )
      const row = result.rows[0]
      if (!row) throw new Error('Submission reservation was not found')
      if (row.fingerprint !== fingerprint) throw new ApiError('idempotency_conflict')
      if (row.expired) throw new ApiError('idempotency_expired')
      if (row.state === 'completed') {
        if (!row.note_id) throw new Error('Completed submission has no note')
        const visible = await client.query('SELECT id FROM expense_notes WHERE id=$1 AND user_id=$2', [row.note_id, actor.id])
        if (!visible.rows[0]) throw new ApiError('not_found')
        return { kind: 'replay', expense: replayDto(row.result, actor.id, row.note_id) }
      }
      if (row.state === 'processing' && row.lease_active) throw new ApiError('idempotency_in_progress')
      if (row.current_attempt_id) await client.query(
        `UPDATE expense_submission_attempts SET state='retired',updated_at=clock_timestamp()
         WHERE operation_id=$1 AND id=$2 AND state='active'`, [row.id, row.current_attempt_id],
      )
      const attemptId = randomUUID()
      const receiptKey = `receipts/${attemptId}${extension}`
      await client.query(
        `INSERT INTO expense_submission_attempts (id,operation_id,user_id,company_id,extension,receipt_key)
         VALUES ($1,$2,$3,$4,$5,$6)`, [attemptId, row.id, actor.id, actor.companyId, extension, receiptKey],
      )
      const claimed = await client.query(
        `UPDATE expense_submission_operations SET state='processing',current_attempt_id=$2,
          lease_until=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp()
         WHERE id=$1 RETURNING id`, [row.id, attemptId],
      )
      if (claimed.rows.length !== 1) throw new Error('Submission attempt was not reserved')
      return { kind: 'attempt', claim: Object.freeze({ operationId: row.id, attemptId, userId: actor.id, companyId: actor.companyId, receiptKey }) }
    })
  }

  async retireFailedAttempt(claim: SubmissionClaim): Promise<void> {
    await withCurrentActor(undefined, async (client, actor) => {
      assertClaimScope(claim, actor)
      const result = await client.query<{ state: string; current_attempt_id: string | null }>(
        `SELECT state,current_attempt_id FROM expense_submission_operations
         WHERE id=$1 AND user_id=$2 AND company_id=$3 FOR UPDATE`, [claim.operationId, actor.id, actor.companyId],
      )
      const row = result.rows[0]
      // Never overwrite a committed result or another process's newer attempt.
      if (!row || row.state === 'completed' || row.current_attempt_id !== claim.attemptId) return
      const retired = await client.query(
        `UPDATE expense_submission_operations SET state='failed',current_attempt_id=NULL,
          lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1 RETURNING id`, [claim.operationId],
      )
      if (retired.rows.length !== 1) throw new Error('Submission attempt state was not recorded')
      await client.query(
        `UPDATE expense_submission_attempts SET state='retired',updated_at=clock_timestamp()
         WHERE operation_id=$1 AND id=$2 AND state='active'`, [claim.operationId, claim.attemptId],
      )
    })
  }
}
