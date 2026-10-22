import { withCurrentActor } from '@/lib/current-actor'
import { ApiError, readJsonObject, withApiHandler } from '@/lib/errors'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiHandler(request, 'hr.users.manager', async () => {
    // Buffer untrusted input before taking any database lock. Report its error only after
    // the current actor is authorized, preserving 401/403 precedence over malformed input.
    const input = await readAssignment(request).then(
      (managerId) => ({ ok: true as const, managerId }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    return withCurrentActor('hr_admin', async (client, actor) => {
      if (!input.ok) throw input.error
      const { managerId } = input
      const { id } = await params

      // Stable row order; role/company checks and the update share this transaction.
      const candidates = await client.query<{ id: string; role: string; is_active: boolean }>(
        `SELECT id, role, is_active FROM users
         WHERE id = ANY($1::uuid[]) AND company_id = $2
         ORDER BY id FOR UPDATE NOWAIT`,
        [managerId === null ? [id] : [id, managerId], actor.companyId],
      ).catch((error: unknown) => {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === '55P03') {
          throw new ApiError('manager_assignment_busy')
        }
        throw error
      })
      const target = candidates.rows.find((row) => row.id === id.toLowerCase())
      if (!target || !['employee', 'manager'].includes(target.role)) throw new ApiError('not_found')
      if (managerId !== null) {
        const manager = candidates.rows.find((row) => row.id === managerId.toLowerCase())
        if (!manager || manager.role !== 'manager' || !manager.is_active || manager.id === target.id) {
          throw new ApiError('invalid_manager')
        }
      }

      const updated = await client.query(
        `UPDATE users SET manager_id = $1 WHERE id = $2 AND company_id = $3
         RETURNING id, name, email, role, manager_id`,
        [managerId, target.id, actor.companyId],
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
  })
}

async function readAssignment(request: Request): Promise<string | null> {
  const body = await readJsonObject(request)
  const managerId = body.managerId
  if (
    managerId !== null &&
    (typeof managerId !== 'string' ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(managerId))
  ) {
    throw new ApiError('invalid_manager_assignment')
  }
  return managerId
}
