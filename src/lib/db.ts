import { Pool, types, type PoolClient } from 'pg'

// OID 1082 = date. Garde la chaîne "YYYY-MM-DD" brute renvoyée par Postgres
// plutôt qu'un objet Date JS calé sur le fuseau local.
types.setTypeParser(1082, (value: string) => value)

declare global {
  var __pgPool: Pool | undefined
}

export function getPool(): Pool {
  if (!global.__pgPool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set')
    }
    global.__pgPool = new Pool({ connectionString, max: 20 })
  }
  return global.__pgPool
}

/**
 * Pose l'identité serveur pour la durée de la transaction. Ce contexte seul
 * ne garantit pas l'isolation : le rôle local actuel est superutilisateur et
 * contourne les policies. HA-04 doit encore intégrer et prouver un rôle limité.
 */
export async function withUserScope<T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPool()
  const client = await pool.connect()
  let discard = false
  try {
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId])
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { discard = true }
    throw error
  } finally {
    client.release(discard)
  }
}
