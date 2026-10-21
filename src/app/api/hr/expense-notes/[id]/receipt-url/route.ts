import { auth } from '@/lib/auth'
import { withUserScope } from '@/lib/db'
import { ApiError, withApiHandler } from '@/lib/errors'
import { getReceiptUrl } from '@/lib/storage'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiHandler(request, 'hr.expense-notes.receipt-url', async () => {
    const session = await auth()
    if (!session?.user) throw new ApiError('unauthenticated')
    if (session.user.role !== 'hr_admin') throw new ApiError('forbidden')
    const { id } = await params

    const note = await withUserScope(session.user.id, async (client) => {
      const result = await client.query(
        `SELECT en.receipt_key FROM expense_notes en
         JOIN users u ON u.id = en.user_id
         WHERE en.id = $1 AND u.role = 'manager' AND u.manager_id IS NULL
           AND u.company_id = (SELECT company_id FROM users WHERE id = $2)`,
        [id, session.user.id]
      )
      return result.rows[0]
    })
    if (!note) {
      throw new ApiError('not_found')
    }

    const url = await getReceiptUrl(note.receipt_key)
    return Response.json({ url })
  })
}
