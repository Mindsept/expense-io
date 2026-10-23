import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PoolClient } from 'pg'
import { assignManager } from '@/lib/assign-manager'

const company = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const target = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const parent = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const actor = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', companyId: company, role: 'hr_admin' as const }
const query = vi.fn()
const client = { query } as unknown as PoolClient
let graph: { id: string; role: string; is_active: boolean; manager_id: string | null }[]

beforeEach(() => {
  vi.resetAllMocks()
  graph = [{ id: target, role: 'manager', is_active: true, manager_id: null }, { id: parent, role: 'manager', is_active: true, manager_id: null }]
  query.mockImplementation(async (sql: string) => {
    if (sql.startsWith('SELECT id, role')) return { rows: graph }
    if (sql.startsWith('UPDATE')) return { rows: [{ id: target, name: 'Target', email: 'target@example.test', role: 'manager', is_active: true, manager_id: parent }] }
    return { rows: [] }
  })
})

describe('transactional assignment integration', () => {
  it('takes the company lock before candidate locks and validation, then updates on the supplied connection', async () => {
    const result = await assignManager(client, actor, target, parent)
    expect(result.id).toBe(target)
    expect(query.mock.calls.map(([sql]) => sql.split('\n')[0])).toEqual([
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', 'SELECT id, role, is_active, manager_id FROM users',
      'SELECT id, role, manager_id FROM users WHERE company_id = $1',
      'UPDATE users SET manager_id = $1 WHERE id = $2 AND company_id = $3',
      'INSERT INTO management_changes',
    ])
    expect(query.mock.calls[0][1]).toEqual([`expense-io:management:${company}`])
  })
  it('refuses a non-HR caller before accessing the database', async () => {
    await expect(assignManager(client, { ...actor, role: 'manager' }, target, parent)).rejects.toMatchObject({ code: 'forbidden' })
    expect(query).not.toHaveBeenCalled()
  })
  it('never writes after detecting an indirect cycle', async () => {
    graph[1].manager_id = target
    await expect(assignManager(client, actor, target, parent)).rejects.toMatchObject({ code: 'manager_cycle' })
    expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false)
  })
  it('keeps null assignment serialized but permits removal without traversing the old chain', async () => {
    graph[0].manager_id = parent
    graph[1].manager_id = target
    await assignManager(client, actor, target, null)
    expect(query.mock.calls.some(([sql]) => sql.includes('pg_advisory_xact_lock'))).toBe(true)
    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE users'), [null, target, company])
  })
  it('normalizes uppercase UUID inputs through canonical database records', async () => {
    await assignManager(client, actor, target.toUpperCase(), parent.toUpperCase())
    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE users'), [parent.toUpperCase(), target, company])
  })
  it('maps only a candidate lock conflict to a static retryable problem without writing', async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce({ code: '55P03', message: 'private database detail' })
    await expect(assignManager(client, actor, target, parent)).rejects.toMatchObject({ code: 'manager_assignment_busy' })
    expect(query.mock.calls[1][0]).toContain('FOR UPDATE NOWAIT')
    expect(query).toHaveBeenCalledTimes(2)
  })
  it('does not disguise unexpected database failures as a retryable assignment', async () => {
    const failure = { code: '40P01', message: 'private database detail' }
    query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(failure)
    await expect(assignManager(client, actor, target, parent)).rejects.toBe(failure)
    expect(query).toHaveBeenCalledTimes(2)
  })
})
