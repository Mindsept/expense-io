import type { JWT } from 'next-auth/jwt'
import { getPool } from '@/lib/db'
import type { UserRole } from '@/domain/User'

/** Applied to every JWT session read, including pages and other authors' routes. */
export async function refreshCurrentSession(token: JWT): Promise<JWT | null> {
  if (typeof token.id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(token.id)) return null
  try {
    const result = await getPool().query<{ role: string; email: string }>(
      'SELECT role, email FROM users WHERE id = $1 AND is_active', [token.id],
    )
    const user = result.rows[0]
    if (!user || !['employee', 'manager', 'hr_admin'].includes(user.role)) return null
    return { ...token, role: user.role as UserRole, email: user.email }
  } catch {
    // Auth.js logs callback failures; never pass it a raw database exception.
    throw new Error('The current account could not be verified.')
  }
}
