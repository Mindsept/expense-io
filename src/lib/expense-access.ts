import type { UserRole } from '@/domain/User'

/** PO-01, 22 October: eligibility, not notification assignment between HR users.
 * `u` is the expense author. Parameter positions are internal constants only.
 * Inactive authors' notes stay processable; only validators must be active.
 */
export function expenseValidatorSql(role: UserRole, actorParameter = 2, companyParameter = 3): string {
  const actor = `$${actorParameter}`
  const company = `$${companyParameter}`
  const common = `u.company_id = ${company} AND u.id <> ${actor}`
  if (role === 'manager') return `${common} AND u.role <> 'hr_admin' AND u.manager_id = ${actor}`
  if (role === 'hr_admin') return `${common} AND (u.role = 'hr_admin' OR NOT EXISTS (
    SELECT 1 FROM users direct_manager
    WHERE direct_manager.id = u.manager_id AND direct_manager.company_id = u.company_id
      AND direct_manager.role = 'manager' AND direct_manager.is_active
  ))`
  return 'FALSE'
}
