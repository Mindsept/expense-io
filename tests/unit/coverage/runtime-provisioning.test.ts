import { beforeEach, expect, it, vi } from 'vitest'
import { inspectRls } from '../../../scripts/rls/readiness.mjs'
import { provisionRuntime, provisionFromEnvironment } from '../../../scripts/rls/provision-runtime.mjs'
import { bootstrapCompany } from '../../../scripts/hamza/enrollment-bootstrap.mjs'
import { database } from './database-helper'
const io = vi.hoisted(() => ({ connect: vi.fn(), end: vi.fn(), hash: vi.fn() }))
vi.mock('pg', () => ({ Pool: class { connect = io.connect; end = io.end } }))
vi.mock('bcryptjs', () => ({ default: { hash: io.hash } }))
beforeEach(() => { vi.resetAllMocks(); io.hash.mockResolvedValue('test-hash') })
it.each([false, true])('reports the actual RLS structural risks (unsafe=%s)', async unsafe => {
  const db = database(sql => ({ rows:
    sql.includes('FROM pg_roles WHERE rolname') ? [{ name: 'expense_web', superuser: unsafe, bypass_rls: unsafe, create_role: unsafe, create_database: unsafe }] :
    sql.includes('FROM pg_class') ? [{ name: 'users', effective_owner: unsafe, can_truncate: unsafe, business_access: true, enabled: !unsafe, policy_count: 1 }, { name: 'notes', column_access: true, enabled: true, policy_count: unsafe ? 0 : 1 }] :
    sql.includes('rolname NOT IN') ? (unsafe ? [{ name: 'powerful-role' }] : []) :
    sql.includes('has_schema_privilege') && !sql.includes('pg_proc') ? [{ can_create: unsafe }] :
    sql.includes('has_database_privilege') ? [{ can_create_schema: unsafe }] :
    sql.includes('pg_proc') ? [{ name: 'visible()', executable: unsafe, public_execute: true, search_path: null, owner_superuser: true }] : [] }))
  const result = await inspectRls(db.client)
  expect(result.status).toBe(unsafe ? 'blocked' : 'structural_checks_passed_not_isolation_proof')
  if (unsafe) expect(result.issues.map((i: { code: string }) => i.code)).toEqual(expect.arrayContaining(['role.superuser', 'session.bypass_rls', 'role.membership_review', 'schema.create', 'database.create_schema', 'function.definer_review', 'function.public_execute', 'function.unpinned_search_path', 'function.privileged_owner', 'table.owner', 'table.truncate', 'table.rls_disabled', 'table.no_policy']))
  else expect(result.issues).toEqual([])
})
it('flags an empty schema as unready', async () => {
  const db = database(sql => ({ rows: sql.includes('FROM pg_roles WHERE') || sql.includes('AS can_create') ? [{}] : [] }))
  expect((await inspectRls(db.client)).issues).toContainEqual({ code: 'schema.empty' })
})
function provisioning(fault = '') {
  return database(sql => ({ rows: sql.includes('current_role') ? [{ current_role: 'admin', login_role: fault === 'set-role' ? 'other' : 'admin', rolsuper: fault !== 'admin' }] : sql.startsWith('SELECT rolsuper') ? (fault === 'missing' ? [] : [{ rolsuper: fault === 'unsafe' }]) : sql.startsWith('SELECT format') ? [{ command: 'ALTER ROLE fixture' }] : [] }))
}
it.each(['expense_web', 'expense_notifications'])('provisions the limited %s role from an explicit admin connection', async role => {
  const db = provisioning()
  await expect(provisionRuntime(db.pool, 'p'.repeat(32), role)).resolves.toBeUndefined()
  expect(db.query.mock.calls.at(-1)?.[0]).toBe('ALTER ROLE fixture'); expect(db.release).toHaveBeenCalledOnce()
})
it.each(['admin', 'set-role', 'missing', 'unsafe'])('refuses unsafe provisioning: %s', async fault => {
  const db = provisioning(fault); await expect(provisionRuntime(db.pool, 'p'.repeat(32))).rejects.toThrow(); expect(db.release).toHaveBeenCalledOnce()
  expect(db.query.mock.calls.some(([sql]) => sql.startsWith('ALTER'))).toBe(false)
})
it.each(['short', 'p'.repeat(257), 'p'.repeat(32) + '\n'])('rejects invalid runtime password before connecting', async password => {
  const db = provisioning(); await expect(provisionRuntime(db.pool, password)).rejects.toThrow('private runtime password'); expect(db.connect).not.toHaveBeenCalled()
})
it('requires an approved role name and explicit admin environment', async () => {
  const db = provisioning(); await expect(provisionRuntime(db.pool, 'p'.repeat(32), 'admin')).rejects.toThrow('Unknown runtime role')
  await expect(provisionFromEnvironment({ DATABASE_URL: 'not-a-fallback' }, 'p'.repeat(32))).rejects.toThrow('HA04_ADMIN_DATABASE_URL')
  io.connect.mockResolvedValue(db.client)
  await provisionFromEnvironment({ HA04_ADMIN_DATABASE_URL: 'postgres://synthetic' }, 'p'.repeat(32))
  expect(io.end).toHaveBeenCalledOnce()
})
const bootstrapInput = { companyName: ' Demo ', companyDomain: 'demo.example.test', name: ' Alice ', email: 'alice@different.example.test', password: 'private-test-password' }
it.each(['ok', 'forbidden', 'duplicate', 'database', 'rollback'])('bootstrap keeps affiliation explicit and handles %s', async fault => {
  const db = database(sql => {
    if (sql.includes('AS permitted')) return { rows: [{ permitted: fault !== 'forbidden' }] }
    if (sql.includes('INSERT INTO')) { if (fault !== 'ok') throw { code: fault === 'duplicate' ? '23505' : 'XX000' }; return { rows: [{ id: sql.includes('.companies') ? 'company' : 'first-hr' }] } }
    if (sql === 'ROLLBACK' && fault === 'rollback') throw new Error('lost')
    return { rows: [] }
  })
  if (fault === 'ok') expect(await bootstrapCompany(db.pool, bootstrapInput)).toEqual({ kind: 'company_bootstrapped', companyId: 'company', firstHrId: 'first-hr', next: 'sign_in' })
  else await expect(bootstrapCompany(db.pool, bootstrapInput)).rejects.toMatchObject({ code: fault === 'forbidden' ? 'administrator_required' : fault === 'duplicate' ? 'bootstrap_conflict' : 'bootstrap_unavailable' })
  expect(db.release).toHaveBeenCalledOnce()
})
it('rejects invalid bootstrap schemas and handles hash failures without connecting', async () => {
  const db = provisioning()
  await expect(bootstrapCompany(db.pool, bootstrapInput, { schemaName: 'unsafe;DROP' })).rejects.toMatchObject({ code: 'invalid_input' })
  io.hash.mockRejectedValue(new Error('failure'))
  await expect(bootstrapCompany(db.pool, bootstrapInput)).rejects.toMatchObject({ code: 'bootstrap_unavailable' })
  expect(db.connect).not.toHaveBeenCalled()
})
