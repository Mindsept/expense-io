import { expenseValidatorSql } from '@/lib/expense-access'
import { withCurrentActor } from '@/lib/current-actor'
import { ApiError, withApiHandler } from '@/lib/errors'
import { getReceiptUrl } from '@/lib/storage'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiHandler(request, 'manager.expense-notes.receipt-url', async () => {
    return withCurrentActor('manager', async (client, actor) => {
      const { id } = await params
      const result = await client.query(
        `SELECT en.receipt_key FROM expense_notes en
         JOIN users u ON u.id = en.user_id
         WHERE en.id = $1 AND ${expenseValidatorSql('manager')}
         FOR SHARE OF u`,
        [id, actor.id, actor.companyId],
      )
      const key = result.rows[0]?.receipt_key
      if (typeof key !== 'string' || key.trim().length === 0) throw new ApiError('not_found')
      const url = await getReceiptUrl(key)
      return Response.json({ url })
    })
  })
}
