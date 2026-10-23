import { auth } from '@/lib/auth'
import { withCurrentActor } from '@/lib/current-actor'
import { ApiError, withApiHandler } from '@/lib/errors'
import { expenseSort, readExpenseForm } from '@/lib/expense-input'
import { receiptKeyFor, uploadReceipt } from '@/lib/storage'
import { toExpenseNote } from '@/adapters/expense-note-mapper'

export async function GET(request: Request) {
  return withApiHandler(request, 'expense-notes.list', async () => {
    return withCurrentActor(undefined, async (client, actor) => {
      const sort = expenseSort(new URL(request.url).searchParams)
      const result = await client.query(
        `SELECT * FROM expense_notes WHERE user_id = $1 ORDER BY ${sort}`,
        [actor.id]
      )
      return Response.json(result.rows.map((row) => toExpenseNote(row)))
    })
  })
}

export async function POST(request: Request) {
  return withApiHandler(request, 'expense-notes.submit', async () => {
    const session = await auth()
    if (!session?.user) throw new ApiError('unauthenticated')

    // Gate parsing with the refreshed session, then reload/lock the current actor
    // for each database operation. Never hold an actor lock while reading a body
    // or uploading S3 bytes. LE-02 owns reconciliation of partial submissions.
    const input = await readExpenseForm(request)

    const note = await withCurrentActor(undefined, async (client, actor) => {
      const inserted = await client.query(
        `INSERT INTO expense_notes (user_id, amount, expense_date, description, receipt_key)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [actor.id, input.amount, input.expenseDate, input.description, '']
      )
      return inserted.rows[0]
    })

    const receiptKey = receiptKeyFor(note.receipt_seq, input.extension)
    await uploadReceipt(receiptKey, input.buffer, input.mimeType)

    return withCurrentActor(undefined, async (client, actor) => {
      const updated = await client.query(
        `UPDATE expense_notes SET receipt_key = $1 WHERE id = $2 AND user_id = $3 RETURNING *`,
        [receiptKey, note.id, actor.id],
      )
      if (!updated.rows[0]) throw new ApiError('not_found')
      return Response.json(toExpenseNote(updated.rows[0]), { status: 201 })
    })
  })
}
