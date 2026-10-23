import type { PoolClient } from 'pg'
import type { CurrentActor } from '@/lib/current-actor'

export type ManagementState = { role: string; is_active: boolean; manager_id: string | null }

export async function appendManagementChange(
  client: PoolClient, actor: CurrentActor, targetId: string, before: ManagementState, after: ManagementState,
): Promise<void> {
  if (before.role === after.role && before.is_active === after.is_active && before.manager_id === after.manager_id) return
  await client.query(`INSERT INTO management_changes
    (company_id, actor_id, target_id, from_role, to_role, from_active, to_active, from_manager_id, to_manager_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
  [actor.companyId, actor.id, targetId, before.role, after.role, before.is_active, after.is_active, before.manager_id, after.manager_id])
}
