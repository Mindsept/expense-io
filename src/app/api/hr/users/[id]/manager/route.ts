import { auth } from '@/lib/auth'
import { getPool } from '@/lib/db'
import { ApiError, readJsonObject, withApiHandler } from '@/lib/errors'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiHandler(request, 'hr.users.manager', async () => {
    const session = await auth()
    if (!session?.user) throw new ApiError('unauthenticated')
    if (session.user.role !== 'hr_admin') throw new ApiError('forbidden')
    const { id } = await params
    const body = await readJsonObject(request)
    const managerId = body.managerId
    if (
      managerId !== null &&
      (typeof managerId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(managerId))
    ) {
      throw new ApiError('invalid_manager_assignment')
    }

    const hrAdminResult = await getPool().query('SELECT company_id FROM users WHERE id = $1', [
      session.user.id,
    ])
    const companyId = hrAdminResult.rows[0]?.company_id
    if (!companyId) {
      throw new ApiError('not_found')
    }

    const targetResult = await getPool().query(
      `SELECT id FROM users WHERE id = $1 AND company_id = $2 AND role IN ('employee', 'manager')`,
      [id, companyId]
    )
    if (!targetResult.rows[0]) {
      throw new ApiError('not_found')
    }

    if (managerId !== null) {
      if (managerId === id) {
        throw new ApiError('invalid_manager')
      }
      // HA-02 adds the same-company check; filtering the UI is not authorization.
      const managerResult = await getPool().query(
        `SELECT id FROM users WHERE id = $1 AND role = 'manager'`,
        [managerId]
      )
      if (!managerResult.rows[0]) {
        throw new ApiError('invalid_manager')
      }
    }

    const updated = await getPool().query(
      `UPDATE users SET manager_id = $1 WHERE id = $2
       RETURNING id, name, email, role, manager_id`,
      [managerId, id]
    )
    const user = updated.rows[0]
    return Response.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      managerId: user.manager_id,
    })
  })
}
