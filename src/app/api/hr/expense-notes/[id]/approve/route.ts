import { decideExpenseForCurrentActor } from '@/application/observed-decide-expense'
import { withApiHandler } from '@/lib/errors'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiHandler(request, 'hr.expense-notes.approve', async ({ requestId }) => {
    const { id } = await params
    const expense = await decideExpenseForCurrentActor({
      expenseId: id, decision: 'approved', requiredRole: 'hr_admin', requestId,
    })
    return Response.json(expense)
  })
}
