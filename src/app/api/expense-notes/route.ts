import { readPagination, readExpenseOrder, queryPage, listResponse } from '@/lib/pagination'
import { observeHttp } from '@/observability/diagnostics'
import { closeRejectedUpload } from '@/lib/bounded-form'
import { auth } from '@/lib/auth'
import { withCurrentActor } from '@/lib/current-actor'
import { ApiError, withApiHandler } from '@/lib/errors'
import { readExpenseForm } from '@/lib/expense-input'
import { submitExpenseForCurrentActor } from '@/application/submit-expense-for-current-actor'
import { toExpenseNote } from '@/adapters/expense-note-mapper'
import { submissionIntentKey } from '@/lib/submission-intent'
import { submitIdempotentExpense } from '@/application/submit-idempotent-expense'

export async function GET(request: Request) {
  return withApiHandler(request, 'expense-notes.list', async () => {
    return withCurrentActor(undefined, async (client, actor) => {
      const parameters = new URL(request.url).searchParams
      const page = readPagination(parameters), order = readExpenseOrder(parameters, 'created_at DESC')
      const sourceSql = 'SELECT * FROM expense_notes WHERE user_id = $1'
      const result = await queryPage(client, { sourceSql, values: [actor.id], order, page, monetary: true })
      return listResponse({ items: result.rows.map(row => toExpenseNote(row)), pagination: result.pagination, totals: result.totals })
    })
  }, observeHttp)
}

export async function POST(request: Request) {
  const response = await withApiHandler(request, 'expense-notes.submit', async ({ requestId }) => {
    const session = await auth()
    if (!session?.user) throw new ApiError('unauthenticated')

    const key = submissionIntentKey(request.headers)
    const input = await readExpenseForm(request)
    if (key) {
      const result = await submitIdempotentExpense(input, key, { requestId })
      return Response.json(result.expense, { status: 201, headers: { 'Idempotency-Replayed': String(result.replayed) } })
    }
    const note = await submitExpenseForCurrentActor(input, { requestId })
    return Response.json(note, { status: 201 })
  }, observeHttp)
  return closeRejectedUpload(response)
}
