import { vi } from 'vitest'
import type { Pool, PoolClient } from 'pg'

export function database(handler: (sql: string, values: unknown[]) => { rows: unknown[]; rowCount?: number } | Promise<{ rows: unknown[]; rowCount?: number }>) {
  const query = vi.fn(async (sql: string, values: unknown[] = []) => handler(sql, values))
  const release = vi.fn()
  const client = { query, release } as unknown as PoolClient
  const connect = vi.fn(async () => client)
  const pool = { connect, query } as unknown as Pool
  return { pool, client, query, release, connect }
}
export const actor = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', companyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', role: 'hr_admin' as const }
export const eventId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
