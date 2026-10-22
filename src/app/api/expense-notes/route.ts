import { auth } from '@/lib/auth'
import { getPool, withUserScope } from '@/lib/db'
import { ApiError, withApiHandler } from '@/lib/errors'
import { expenseSort, readExpenseForm } from '@/lib/expense-input'
import { receiptKeyFor, uploadReceipt } from '@/lib/storage'
import { toExpenseNote } from '@/adapters/expense-note-mapper'

export async function GET(request: Request) {
  return withApiHandler(request, 'expense-notes.list', async () => {
    const session = await auth()
    if (!session?.user) throw new ApiError('unauthenticated')

    const url = new URL(request.url)
    const sort = expenseSort(url.searchParams)

    return await withUserScope(session.user.id, async (client) => {
      const result = await client.query(
        `SELECT * FROM expense_notes WHERE user_id = $1 ORDER BY ${sort}`,
        [session.user.id]
      )
      return Response.json(result.rows.map((row) => toExpenseNote(row)))
    })
  })
}

export async function POST(request: Request) {
  return withApiHandler(request, 'expense-notes.submit', async () => {
    const session = await auth()
    if (!session?.user) throw new ApiError('unauthenticated')

    const input = await readExpenseForm(request)

    const note = await withUserScope(session.user.id, async (client) => {
      const inserted = await client.query(
        `INSERT INTO expense_notes (user_id, amount, expense_date, description, receipt_key)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [session.user.id, input.amount, input.expenseDate, input.description, '']
      )
      return inserted.rows[0]
    })

    const receiptKey = receiptKeyFor(note.receipt_seq, input.extension)
    await uploadReceipt(receiptKey, input.buffer, input.mimeType)

    const updated = await getPool().query(
      `UPDATE expense_notes SET receipt_key = $1 WHERE id = $2 RETURNING *`,
      [receiptKey, note.id]
    )

    return Response.json(toExpenseNote(updated.rows[0]), { status: 201 })
  })
}
