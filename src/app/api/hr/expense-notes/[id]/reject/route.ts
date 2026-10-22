import { decideExpenseForCurrentActor } from '@/application/decide-expense'
import { withApiHandler } from '@/lib/errors'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiHandler(request, 'hr.expense-notes.reject', async ({ requestId }) => {
    const { id } = await params
    const expense = await decideExpenseForCurrentActor({
      expenseId: id, decision: 'rejected', requiredRole: 'hr_admin', requestId,
    })
    return Response.json(expense)
  })
}
