import type { UserRole } from '@/domain/User'
import { withCurrentActor } from '@/lib/current-actor'
import { changeUserAccess, type AccessChange } from '@/lib/change-user-access'
import { ApiError, readJsonObject, withApiHandler } from '@/lib/errors'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiHandler(request, 'hr.users.access', async () => {
    const input = await readChange(request).then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }))
    return withCurrentActor('hr_admin', async (client, actor) => {
      if (!input.ok) throw input.error
      const { id } = await params
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw new ApiError('validation')
      const user = await changeUserAccess(client, actor, id, input.value)
      return Response.json({ id: user.id, role: user.role, isActive: user.is_active, managerId: user.manager_id })
    })
  })
}

async function readChange(request: Request): Promise<AccessChange> {
  const body = await readJsonObject(request)
  if (!Object.keys(body).length || Object.keys(body).some(key => !['role', 'isActive'].includes(key)) ||
    ('role' in body && !['employee', 'manager', 'hr_admin'].includes(body.role as string)) ||
    ('isActive' in body && typeof body.isActive !== 'boolean')) throw new ApiError('validation')
  return { ...('role' in body ? { role: body.role as UserRole } : {}), ...('isActive' in body ? { isActive: body.isActive as boolean } : {}) }
}
