import { expenseValidatorSql } from '@/lib/expense-access'
import { withCurrentActor } from '@/lib/current-actor'
import { ApiError, withApiHandler } from '@/lib/errors'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiHandler(request, 'manager.expense-notes.approve', async () => {
    return withCurrentActor('manager', async (client, actor) => {
      const { id } = await params
      const existing = await client.query(
        `SELECT en.* FROM expense_notes en
         JOIN users u ON u.id = en.user_id
         WHERE en.id = $1 AND ${expenseValidatorSql('manager')}
         FOR SHARE OF u`,
        [id, actor.id, actor.companyId]
      )
      const row = existing.rows[0]
      if (!row) {
        throw new ApiError('not_found')
      }
      if (row.status !== 'pending') {
        throw new ApiError('conflict')
      }

      const updated = await client.query(
        `UPDATE expense_notes SET status = 'approved' WHERE id = $1 RETURNING *`,
        [id]
      )
      const note = updated.rows[0]
      return Response.json({
        id: note.id,
        userId: note.user_id,
        amount: Number.parseFloat(note.amount),
        expenseDate: note.expense_date,
        description: note.description,
        receiptKey: note.receipt_key,
        status: note.status,
        createdAt: new Date(note.created_at).toISOString(),
      })
    })
  })
}
