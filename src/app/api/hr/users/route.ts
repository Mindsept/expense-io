import { auth } from '@/lib/auth'
import { getPool } from '@/lib/db'
import { ApiError, withApiHandler } from '@/lib/errors'

export async function GET(request: Request) {
  return withApiHandler(request, 'hr.users.list', async () => {
    const session = await auth()
    if (!session?.user) throw new ApiError('unauthenticated')
    if (session.user.role !== 'hr_admin') throw new ApiError('forbidden')

    const result = await getPool().query(
      `SELECT id, name, email, role, manager_id FROM users
       WHERE role IN ('employee', 'manager')
         AND company_id = (SELECT company_id FROM users WHERE id = $1)
       ORDER BY name`,
      [session.user.id]
    )
    return Response.json(
      result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        managerId: row.manager_id,
      }))
    )
  })
}
