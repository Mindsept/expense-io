import type { PoolClient } from 'pg'
import { assessManagerAssignment } from '@/domain/ManagementHierarchy'
import type { UserRole } from '@/domain/User'
import type { CurrentActor } from '@/lib/current-actor'
import { ApiError } from '@/lib/errors'
import { appendManagementChange } from '@/lib/management-change'

type UserRow = { id: string; name: string; email: string; role: UserRole; manager_id: string | null }

/** Call within the current actor's transaction. Every future graph writer must use this same lock. */
export async function assignManager(
  client: PoolClient,
  actor: CurrentActor,
  targetId: string,
  managerId: string | null,
): Promise<UserRow> {
  if (actor.role !== 'hr_admin') throw new ApiError('forbidden')

  // Serialize this company's graph writes before locking candidates. The current HR actor
  // cannot be an assignment target, so its existing FOR SHARE lock does not form a lock cycle.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `expense-io:management:${actor.companyId}`,
  ])
  // A manager decision/receipt holds its actor before its author. Waiting here
  // after locking the author could invert that order, so return a retryable conflict.
  const candidates = await client.query<{ id: string; role: UserRole; is_active: boolean; manager_id: string | null }>(
    `SELECT id, role, is_active, manager_id FROM users
     WHERE id = ANY($1::uuid[]) AND company_id = $2
     ORDER BY id FOR UPDATE NOWAIT`,
    [managerId === null ? [targetId] : [targetId, managerId], actor.companyId],
  ).catch((error: unknown) => {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '55P03') {
      throw new ApiError('manager_assignment_busy')
    }
    throw error
  })
  const target = candidates.rows.find((row) => row.id === targetId.toLowerCase())
  if (!target || !['employee', 'manager'].includes(target.role)) throw new ApiError('not_found')

  if (managerId !== null) {
    const manager = candidates.rows.find((row) => row.id === managerId.toLowerCase())
    if (!manager || manager.role !== 'manager' || !manager.is_active) throw new ApiError('invalid_manager')
    const graph = await client.query<{ id: string; role: UserRole; manager_id: string | null }>(
      'SELECT id, role, manager_id FROM users WHERE company_id = $1', [actor.companyId],
    )
    const assessment = assessManagerAssignment(target.id, manager.id, graph.rows.map((member) => ({
      id: member.id, role: member.role, managerId: member.manager_id,
    })))
    if (assessment === 'cycle') throw new ApiError('manager_cycle')
    if (assessment === 'invalid_chain') throw new ApiError('invalid_manager')
  }

  const updated = await client.query<UserRow>(
    `UPDATE users SET manager_id = $1 WHERE id = $2 AND company_id = $3
     RETURNING id, name, email, role, manager_id`,
    [managerId, target.id, actor.companyId],
  )
  await appendManagementChange(client, actor, target.id, target, { ...target, manager_id: updated.rows[0].manager_id })
  return updated.rows[0]
}
