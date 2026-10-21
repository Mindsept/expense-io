import { auth } from '@/lib/auth'
import { getPool } from '@/lib/db'
import { ApiError, withApiHandler } from '@/lib/errors'
import { getReceiptUrl } from '@/lib/storage'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiHandler(request, 'manager.expense-notes.receipt-url', async () => {
    const session = await auth()
    if (!session?.user) throw new ApiError('unauthenticated')
    if (session.user.role !== 'manager') throw new ApiError('forbidden')
    const { id } = await params

    // HA-02 adds the missing server-side management/company authorization here.
    const result = await getPool().query('SELECT receipt_key FROM expense_notes WHERE id = $1', [id])
    const note = result.rows[0]
    if (!note) {
      throw new ApiError('not_found')
    }

    const url = await getReceiptUrl(note.receipt_key)
    return Response.json({ url })
  })
}
