import { readPagination, readExpenseOrder, queryPage, listResponse } from '@/lib/pagination'
import { hrPendingExpenseSource } from '@/lib/pending-expense-source'
import { toExpenseNote } from '@/adapters/expense-note-mapper'
import { withCurrentActor } from '@/lib/current-actor'
import { withApiHandler } from '@/lib/errors'

export async function GET(request: Request) {
  return withApiHandler(request, 'hr.expense-notes.list', async () => {
    return withCurrentActor('hr_admin', async (client, actor) => {
      const parameters = new URL(request.url).searchParams
      const page = readPagination(parameters), order = readExpenseOrder(parameters, 'created_at ASC')
      const sourceSql = hrPendingExpenseSource()
      const values = [actor.id, actor.companyId]
      const map = (row: Record<string, unknown>) => toExpenseNote(row, { id: row.user_id as string, displayName: (row.author_name as string) || 'User' })
      const result = await queryPage(client, { sourceSql, values, order, page, monetary: true })
      return listResponse({ items: result.rows.map(map), pagination: result.pagination, totals: result.totals })
    })
  })
}
