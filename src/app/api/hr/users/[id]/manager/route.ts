import { assignManager } from '@/lib/assign-manager'
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

      const user = await assignManager(client, actor, id, managerId)
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
