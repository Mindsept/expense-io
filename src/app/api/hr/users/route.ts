import { withCurrentActor } from '@/lib/current-actor'
import { withApiHandler } from '@/lib/errors'

export async function GET(request: Request) {
  return withApiHandler(request, 'hr.users.list', async () => {
    return withCurrentActor('hr_admin', async (client, actor) => {
      const result = await client.query(
        `SELECT id, name, email, role, manager_id FROM users
         WHERE role IN ('employee', 'manager')
           AND company_id = $1
         ORDER BY name`,
        [actor.companyId],
      )
      return Response.json(result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        managerId: row.manager_id,
      })))
    })
  })
}
