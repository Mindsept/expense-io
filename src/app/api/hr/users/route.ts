import { withCurrentActor } from '@/lib/current-actor'
import { withApiHandler } from '@/lib/errors'
import { readPagination, readDirectoryOrder, directoryFilters, queryPage, listResponse } from '@/lib/pagination'

export async function GET(request: Request) {
  return withApiHandler(request, 'hr.users.list', async () => {
    return withCurrentActor('hr_admin', async (client, actor) => {
      const parameters = new URL(request.url).searchParams
      const page = readPagination(parameters), order = readDirectoryOrder(parameters), filters = directoryFilters(parameters)
      const values: unknown[] = [actor.companyId]
      let sourceSql = `SELECT id, name, email, role, manager_id FROM users
         WHERE role IN ('employee', 'manager') AND company_id = $1`
      if (filters.role === 'manager') sourceSql += " AND role = 'manager' AND is_active"
      if (filters.q) {
        values.push(filters.search)
        sourceSql += ` AND (name ILIKE $${values.length} ESCAPE '\\' OR email ILIKE $${values.length} ESCAPE '\\')`
      }
      let selectionSql: string | undefined
      if (filters.selectedManagerId) {
        values.push(filters.selectedManagerId)
        // Resolve the old assignment even if inactive/reclassified or outside q,
        // without treating it as an eligible candidate or leaking another tenant.
        selectionSql = `SELECT jsonb_build_object('id',id,'name',name,'role',role,'isActive',is_active,
          'isEligible',role='manager' AND is_active) FROM users WHERE company_id=$1 AND id=$${values.length}`
      }
      const map = (row: Record<string, unknown>) => ({ id: row.id, name: row.name, email: row.email, role: row.role, managerId: row.manager_id })
      const result = await queryPage(client, { sourceSql, values, order, page, selectionSql })
      return listResponse({ items: result.rows.map(map), pagination: result.pagination, totals: result.totals,
        ...(filters.selectedManagerId ? { selectedManager: result.selectedManager } : {}) })
    })
  })
}
