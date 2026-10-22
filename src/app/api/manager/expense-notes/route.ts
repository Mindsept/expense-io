import { expenseValidatorSql } from '@/lib/expense-access'
import { toExpenseNote } from '@/adapters/expense-note-mapper'
import { withCurrentActor } from '@/lib/current-actor'
import { withApiHandler } from '@/lib/errors'

export async function GET(request: Request) {
  return withApiHandler(request, 'manager.expense-notes.list', async () => {
    return withCurrentActor('manager', async (client, actor) => {
      const result = await client.query(
        `SELECT en.* FROM expense_notes en
         JOIN users u ON u.id = en.user_id
         WHERE ${expenseValidatorSql('manager', 1, 2)} AND en.status = 'pending'
         ORDER BY en.created_at ASC`,
        [actor.id, actor.companyId]
      )
      return Response.json(result.rows.map((row) => toExpenseNote(row)))
    })
  })
}
