import type { PoolClient } from 'pg'
import type { CurrentActor } from '@/lib/current-actor'
import type { UserRole } from '@/domain/User'
import { appendManagementChange } from '@/lib/management-change'
import { ApiError } from '@/lib/errors'

export type AccessChange = Readonly<{ role?: UserRole; isActive?: boolean }>

/** The caller owns the current actor transaction. No deletion or company transfer. */
export async function changeUserAccess(client: PoolClient, actor: CurrentActor, targetId: string, input: AccessChange) {
  if (actor.role !== 'hr_admin') throw new ApiError('forbidden')
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`expense-io:management:${actor.companyId}`])
  const result = await client.query<{ id: string; role: UserRole; is_active: boolean; manager_id: string | null }>(
    `SELECT id, role, is_active, manager_id FROM users WHERE id=$1 AND company_id=$2 FOR UPDATE NOWAIT`, [targetId, actor.companyId],
  ).catch((error: unknown) => {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '55P03') throw new ApiError('manager_assignment_busy')
    throw error
  })
  const target = result.rows[0]
  if (!target) throw new ApiError('not_found')
  const next = { role: input.role ?? target.role, is_active: input.isActive ?? target.is_active,
    manager_id: input.role === 'hr_admin' ? null : target.manager_id }
  if (target.role === 'hr_admin' && target.is_active && (next.role !== 'hr_admin' || !next.is_active)) {
    const active = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM users WHERE company_id=$1 AND role='hr_admin' AND is_active", [actor.companyId],
    )
    if (active.rows[0].count <= 1) throw new ApiError('last_active_hr')
  }
  // Append while the actor still has their original rights, including a
  // permitted self-demotion. The enclosing transaction rolls it back on failure.
  await appendManagementChange(client, actor, target.id, target, next)
  const updated = await client.query<{ id: string; role: UserRole; is_active: boolean; manager_id: string | null }>(
    `UPDATE users SET role=$1, is_active=$2, manager_id=$3 WHERE id=$4 AND company_id=$5
     RETURNING id, role, is_active, manager_id`, [next.role, next.is_active, next.manager_id, target.id, actor.companyId],
  )
  if (!updated.rows[0]) throw new ApiError('not_found')
  return updated.rows[0]
}
