import { auth } from '@/lib/auth'
import { withUserScope } from '@/lib/db'
import { ApiError, withApiHandler } from '@/lib/errors'

function toExpenseNote(row: Record<string, unknown>) {
  return {
    id: row.id,
    userId: row.user_id,
    amount: Number.parseFloat(row.amount as string),
    expenseDate: row.expense_date,
    description: row.description,
    receiptKey: row.receipt_key,
    status: row.status,
    createdAt: new Date(row.created_at as string).toISOString(),
  }
}

export async function GET(request: Request) {
  return withApiHandler(request, 'manager.expense-notes.list', async () => {
    const session = await auth()
    if (!session?.user) throw new ApiError('unauthenticated')
    if (session.user.role !== 'manager') throw new ApiError('forbidden')

    return withUserScope(session.user.id, async (client) => {
      const result = await client.query(
        `SELECT en.* FROM expense_notes en
         JOIN users u ON u.id = en.user_id
         WHERE u.manager_id = $1 AND en.status = 'pending'
         ORDER BY en.created_at ASC`,
        [session.user.id]
      )
      return Response.json(result.rows.map(toExpenseNote))
    })
  })
}
