import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/lib/db', () => ({ getPool: () => ({ query: mocks.query }) }))
import { refreshCurrentSession } from '@/lib/current-session'
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
beforeEach(() => vi.resetAllMocks())
describe('current session rights', () => {
  it('replaces a signed old role/email with current database values', async () => {
    mocks.query.mockResolvedValue({ rows: [{ role: 'employee', email: 'current@example.test' }] })
    const old = { id, role: 'hr_admin' as const, email: 'old@example.test' }
    expect(await refreshCurrentSession(old)).toEqual({ id, role: 'employee', email: 'current@example.test' })
    expect(old.role).toBe('hr_admin')
    expect(mocks.query).toHaveBeenCalledWith('SELECT role, email FROM expense_auth.session_identity($1::uuid)', [id])
  })
  it('invalidates a token whose user is deleted or disabled', async () => {
    mocks.query.mockResolvedValue({ rows: [] })
    expect(await refreshCurrentSession({ id, role: 'manager' })).toBeNull()
  })
  it('fails closed on an unsupported persisted role', async () => {
    mocks.query.mockResolvedValue({ rows: [{ role: 'superadmin' }] })
    expect(await refreshCurrentSession({ id })).toBeNull()
  })
  it.each([{}, { id: 'untrusted' }])('rejects an invalid identity before database access: %j', async (token) => {
    expect(await refreshCurrentSession(token)).toBeNull()
    expect(mocks.query).not.toHaveBeenCalled()
  })
  it('never forwards a raw database cause to Auth.js logging', async () => {
    mocks.query.mockRejectedValue(new Error('private-database-url-and-password'))
    await expect(refreshCurrentSession({ id })).rejects.toThrow('The current account could not be verified.')
  })
})
