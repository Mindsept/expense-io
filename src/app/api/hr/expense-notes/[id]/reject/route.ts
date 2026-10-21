import { auth } from '@/lib/auth'
import { withUserScope } from '@/lib/db'
import { ApiError, withApiHandler } from '@/lib/errors'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiHandler(request, 'hr.expense-notes.reject', async () => {
    const session = await auth()
    if (!session?.user) throw new ApiError('unauthenticated')
    if (session.user.role !== 'hr_admin') throw new ApiError('forbidden')
    const { id } = await params

    return withUserScope(session.user.id, async (client) => {
      const existing = await client.query(
        `SELECT en.* FROM expense_notes en
         JOIN users u ON u.id = en.user_id
         WHERE en.id = $1 AND u.role = 'manager' AND u.manager_id IS NULL
           AND u.company_id = (SELECT company_id FROM users WHERE id = $2)`,
        [id, session.user.id]
      )
      const row = existing.rows[0]
      if (!row) {
        throw new ApiError('not_found')
      }
      if (row.status !== 'pending') {
        throw new ApiError('conflict')
      }

      const updated = await client.query(
        `UPDATE expense_notes SET status = 'rejected' WHERE id = $1 RETURNING *`,
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
