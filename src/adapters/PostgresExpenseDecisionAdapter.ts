import type { PoolClient } from 'pg'
import { toExpenseNote } from '@/adapters/expense-note-mapper'
import type { ExpenseNoteDto } from '@/contracts/expense-note'
import type { ExpenseNoteStatus } from '@/domain/ExpenseNote'
import type { DecideExpenseInput, ExpenseDecisionEvent, ExpenseDecisionPort, VisibleExpenseState } from '@/ports/ExpenseDecisionPort'
import { expenseValidatorSql } from '@/lib/expense-access'

export class PostgresExpenseDecisionAdapter implements ExpenseDecisionPort<ExpenseNoteDto> {
  constructor(private readonly client: PoolClient) {}

  async findVisible(input: DecideExpenseInput): Promise<VisibleExpenseState | null> {
    const result = await this.client.query<{ id: string; user_id: string; status: ExpenseNoteStatus }>(
      `SELECT en.id, en.user_id, en.status FROM expense_notes en
       JOIN users u ON u.id = en.user_id
       WHERE en.id = $1 AND ${expenseValidatorSql(input.actor.role)}
       FOR SHARE OF u`,
      [input.expenseId, input.actor.id, input.actor.companyId],
    )
    const row = result.rows[0]
    return row ? { id: row.id, ownerId: row.user_id, status: row.status } : null
  }

  async transitionPending(input: DecideExpenseInput): Promise<ExpenseNoteDto | null> {
    const result = await this.client.query(
      `UPDATE expense_notes en SET status = $4
       FROM users u
       WHERE en.id = $1 AND u.id = en.user_id AND en.status = 'pending'
         AND ${expenseValidatorSql(input.actor.role)}
       RETURNING en.*`,
      [input.expenseId, input.actor.id, input.actor.companyId, input.decision],
    )
    // The real LE-12 mapper runs inside the transaction: an invalid persisted DTO rolls back too.
    return result.rows[0] ? toExpenseNote(result.rows[0]) : null
  }

  async appendHistory(input: DecideExpenseInput, ownerId: string): Promise<ExpenseDecisionEvent> {
    const result = await this.client.query<{ id: string; decided_at: Date }>(
      `INSERT INTO expense_decision_history
         (expense_note_id, actor_id, company_id, actor_display_name, from_status, to_status)
       SELECT $1, id, company_id, COALESCE(NULLIF(name, ''), 'User'), 'pending', $3
       FROM users WHERE id = $2
       RETURNING id, decided_at`,
      [input.expenseId, input.actor.id, input.decision],
    )
    const row = result.rows[0]
    if (!row) throw new Error('Decision history was not recorded')
    return Object.freeze({
      id: row.id, expenseId: input.expenseId, companyId: input.actor.companyId, ownerId,
      actorId: input.actor.id, fromStatus: 'pending', toStatus: input.decision,
      decidedAt: row.decided_at.toISOString(),
    })
  }
}
