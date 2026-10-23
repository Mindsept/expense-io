import { readPagination, readExpenseOrder, orderBy, queryPage, listResponse } from '@/lib/pagination'
import { expenseValidatorSql } from '@/lib/expense-access'
import { toExpenseNote } from '@/adapters/expense-note-mapper'
import { withCurrentActor } from '@/lib/current-actor'
import { withApiHandler } from '@/lib/errors'

export async function GET(request: Request) {
  return withApiHandler(request, 'manager.expense-notes.list', async () => {
    return withCurrentActor('manager', async (client, actor) => {
      const parameters = new URL(request.url).searchParams
      const page = readPagination(parameters), order = readExpenseOrder(parameters, 'created_at ASC')
      const sourceSql = `SELECT en.*, u.name AS author_name FROM expense_notes en
         JOIN users u ON u.id = en.user_id
         WHERE ${expenseValidatorSql('manager', 1, 2)} AND en.status = 'pending'`
      const values = [actor.id, actor.companyId]
      const map = (row: Record<string, unknown>) => toExpenseNote(row, { id: row.user_id as string, displayName: (row.author_name as string) || 'User' })
      if (page) {
        const result = await queryPage(client, { sourceSql, values, order, page, monetary: true })
        return listResponse({ items: result.rows.map(map), pagination: result.pagination, totals: result.totals }, true)
      }
      const result = await client.query(`${sourceSql} ORDER BY ${orderBy(order)}`, values)
      return listResponse(result.rows.map(map), false)
    })
  })
}
