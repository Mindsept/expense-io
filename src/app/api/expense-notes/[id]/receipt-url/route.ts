import { withCurrentActor } from '@/lib/current-actor'
import { ApiError, withApiHandler } from '@/lib/errors'
import { getReceiptUrl } from '@/lib/storage'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiHandler(request, 'expense-notes.receipt-url', async () => {
    return withCurrentActor(undefined, async (client, actor) => {
      const { id } = await params
      const result = await client.query(
        `SELECT receipt_key FROM expense_notes WHERE id = $1 AND user_id = $2`,
        [id, actor.id],
      )
      const key = result.rows[0]?.receipt_key
      if (typeof key !== 'string' || key.trim().length === 0) throw new ApiError('not_found')
      const url = await getReceiptUrl(key)
      return Response.json({ url })
    })
  })
}
