import type { PoolClient } from 'pg'
import type { UserRole } from '@/domain/User'
import { auth } from '@/lib/auth'
import { withUserScope } from '@/lib/db'
import { ApiError } from '@/lib/errors'

export type CurrentActor = Readonly<{ id: string; companyId: string; role: UserRole }>

/** A signed session identifies the user; current database state grants their rights. */
export async function withCurrentActor<T>(
  requiredRole: UserRole | undefined,
  operation: (client: PoolClient, actor: CurrentActor) => Promise<T>,
): Promise<T> {
  const session = await auth()
  const id = session?.user?.id
  if (typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    throw new ApiError('unauthenticated')
  }
  return withUserScope(id, async (client) => {
    const result = await client.query<{ id: string; company_id: string; role: UserRole; is_active: boolean }>(
      'SELECT id, company_id, role, is_active FROM users WHERE id = $1 FOR SHARE', [id],
    )
    const row = result.rows[0]
    if (!row || row.is_active !== true) throw new ApiError('unauthenticated')
    if (!row.company_id || !['employee', 'manager', 'hr_admin'].includes(row.role)) {
      throw new ApiError('forbidden')
    }
    if (requiredRole && row.role !== requiredRole) throw new ApiError('forbidden')
    return operation(client, Object.freeze({ id: row.id, companyId: row.company_id, role: row.role }))
  })
}
