import { auth } from '@/lib/auth'
import { withCurrentActor } from '@/lib/current-actor'
import { ApiError, withApiHandler } from '@/lib/errors'
import { expenseSort, readExpenseForm } from '@/lib/expense-input'
import { submitExpenseForCurrentActor } from '@/application/submit-expense-for-current-actor'
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
  return withApiHandler(request, 'expense-notes.submit', async ({ requestId }) => {
    const session = await auth()
    if (!session?.user) throw new ApiError('unauthenticated')

    const input = await readExpenseForm(request)
    const note = await submitExpenseForCurrentActor(input, { requestId })
    return Response.json(note, { status: 201 })
  })
}
