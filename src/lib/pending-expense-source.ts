import { expenseValidatorSql } from '@/lib/expense-access'

/** Keep the eligible-author relation outside the security-filtered note scan.
 * OFFSET 0 prevents flattening the lateral relation back into a global note
 * scan. The exact shared eligibility predicate and RLS still apply; only the
 * join strategy changes. Parameters remain actor $1 / company $2.
 */
export function hrPendingExpenseSource(): string {
  return `SELECT en.*, u.name AS author_name FROM users u
    JOIN LATERAL (SELECT * FROM expense_notes WHERE user_id=u.id AND status='pending' OFFSET 0) en ON true
    WHERE ${expenseValidatorSql('hr_admin', 1, 2)}`
}
