import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
const io = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), end: vi.fn(), release: vi.fn(), pool: vi.fn(), hash: vi.fn(), assertWorker: vi.fn(), decision: vi.fn(), assignment: vi.fn(), scan: vi.fn(), delay: vi.fn(), reconcile: vi.fn(), send: vi.fn(), destroy: vi.fn() }))
vi.mock('pg', () => ({ Pool: class { constructor(options: unknown) { io.pool(options) } query = io.query; connect = io.connect; end = io.end }, Client: class { query = io.query; connect = io.connect; end = io.end } }))
vi.mock('bcryptjs', () => ({ default: { hash: io.hash } }))
vi.mock('node:timers/promises', () => ({ setTimeout: io.delay }))
vi.mock('@/lib/notifications/inbox.ts', () => ({ assertNotificationWorker: io.assertWorker, deliverOneDecisionNotification: io.decision, deliverOneAssignment: io.assignment, scanAssignments: io.scan }))
vi.mock('@/lib/submission-reconciliation.mjs', async importOriginal => ({ ...await importOriginal<object>(), reconcileSubmissions: io.reconcile }))
vi.mock('@aws-sdk/client-s3', () => ({ S3Client: class { send = io.send; destroy = io.destroy }, DeleteObjectCommand: class { constructor(public input: unknown) {} } }))
const originalArgv = process.argv, originalExit = process.exitCode, stdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin')!
const signals = new Map<string | symbol, () => void>()
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
beforeEach(() => {
  vi.resetAllMocks(); vi.resetModules(); signals.clear(); process.exitCode = 0
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(process, 'once').mockImplementation((event, listener) => { signals.set(event, listener); return process })
  io.connect.mockResolvedValue({ query: io.query, release: io.release }); io.end.mockResolvedValue(undefined)
  io.query.mockResolvedValue({ rows: [], rowCount: 0 }); io.hash.mockResolvedValue('hash-of-private-password')
  io.decision.mockResolvedValue({ outcome: 'idle' }); io.assignment.mockResolvedValue({ outcome: 'idle' }); io.scan.mockResolvedValue({ scanned: 2 })
  io.reconcile.mockResolvedValue({ items: [{ status: 'deleted' }] })
  for (const name of Object.keys(process.env)) if (/(ADMIN|BOOTSTRAP|MIGRATION).*DATABASE_URL/.test(name)) vi.stubEnv(name, undefined)
})
afterEach(() => { process.argv = originalArgv; process.exitCode = originalExit; Object.defineProperty(process, 'stdin', stdinDescriptor); vi.restoreAllMocks(); vi.unstubAllEnvs() })
function args(...values: string[]) { process.argv = [process.execPath, 'maintenance.mjs', ...values] }
function input(value: string) { Object.defineProperty(process, 'stdin', { configurable: true, value: Readable.from([Buffer.from(value)]) }) }
function workerEnv(mode = '--once') { args(mode); vi.stubEnv('NOTIFICATION_WORKER_DATABASE_URL', 'postgres://limited-worker@127.0.0.1/test') }
it('delivers a bounded notification batch, reports outcomes and closes the limited connection', async () => {
  workerEnv(); io.decision.mockResolvedValueOnce({ outcome: 'delivered' }).mockResolvedValueOnce({ outcome: 'retry' }); io.assignment.mockResolvedValueOnce({ outcome: 'failed' }).mockResolvedValueOnce({ outcome: 'obsolete' })
  await import('../../../scripts/notifications/worker.mjs')
  expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0][0]))).toEqual({ scanned: 2, delivered: 1, retry: 1, failed: 1, obsolete: 1 })
  expect(io.pool).toHaveBeenCalledWith(expect.objectContaining({ max: 1, options: '-c search_path=pg_catalog,public,pg_temp' })); expect(io.end).toHaveBeenCalledOnce()
})
it('polls in serve mode until a shutdown signal and caps each delivery cycle', async () => {
  workerEnv('--serve'); io.decision.mockResolvedValue({ outcome: 'delivered' }); io.delay.mockImplementation(async () => signals.get('SIGTERM')!())
  await import('../../../scripts/notifications/worker.mjs')
  expect(io.decision).toHaveBeenCalledTimes(25); expect(io.delay).toHaveBeenCalledWith(1000); expect(io.end).toHaveBeenCalledOnce()
})
it.each(['--failed', '--routing'])('lists only the bounded operational %s report', async mode => {
  workerEnv(mode); io.query.mockResolvedValue({ rows: [{ event_id: id }] })
  await import('../../../scripts/notifications/worker.mjs')
  expect(io.query.mock.calls[0][0]).toContain('LIMIT 100'); expect(console.log).toHaveBeenCalledWith(JSON.stringify([{ event_id: id }]))
})
it.each(['decision', 'assignment'])('requeues only the specified failed %s event and company', async kind => {
  workerEnv(); args('--requeue', kind, id, id); io.query.mockResolvedValue({ rowCount: 1 })
  await import('../../../scripts/notifications/worker.mjs')
  expect(io.query).toHaveBeenCalledWith(expect.stringContaining(`public.${kind}_notification_outbox`), [id, id]); expect(io.query.mock.calls[0][0]).toContain("state='failed'"); expect(console.log).toHaveBeenCalledWith('{"requeued":1}')
})
it.each(['mode', 'missing-connection', 'administrator', 'requeue-kind', 'requeue-id', 'worker-role', 'delivery'])('refuses unsafe worker operation: %s', async fault => {
  workerEnv()
  if (fault === 'mode') args('--unknown')
  if (fault === 'missing-connection') vi.stubEnv('NOTIFICATION_WORKER_DATABASE_URL', undefined)
  if (fault === 'administrator') vi.stubEnv('HA09_ADMIN_DATABASE_URL', 'private-admin-secret')
  if (fault === 'requeue-kind') args('--requeue', 'unknown', id, id)
  if (fault === 'requeue-id') args('--requeue', 'decision', 'bad-id', id)
  if (fault === 'worker-role') io.assertWorker.mockRejectedValue(new Error('private-admin-secret'))
  if (fault === 'delivery') io.decision.mockRejectedValue(new Error('private-admin-secret'))
  await import('../../../scripts/notifications/worker.mjs')
  expect(process.exitCode).toBe(1); expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private-admin-secret')
  if (['mode', 'missing-connection', 'administrator'].includes(fault)) expect(io.pool).not.toHaveBeenCalled()
  else expect(io.end).toHaveBeenCalledOnce()
})

function reconciliationEnv() {
  for (const [name, value] of Object.entries({ LE03_MAINTENANCE_DATABASE_URL: 'postgres://maintenance@test/database', S3_ENDPOINT: 'http://127.0.0.1:4569', S3_BUCKET: 'receipts-test', S3_ACCESS_KEY_ID: 'synthetic', S3_SECRET_ACCESS_KEY: 'private-test-secret' })) vi.stubEnv(name, value)
}
it.each([false, true])('parses reconciliation filters with explicit apply=%s and deletes only through its bounded storage adapter', async apply => {
  reconciliationEnv(); args(apply ? '--apply' : '--dry-run', '--company-id', id, '--limit', '3', '--min-age-ms', '300000', '--max-duration-ms', '1000')
  io.reconcile.mockImplementation(async options => { expect(options).toMatchObject({ apply, companyId: id, limit: 3, minAgeMs: 300000, maxDurationMs: 1000 }); await options.removeReceipt('synthetic-key', 1000); return { items: [{ status: 'deleted' }] } })
  await import('../../../scripts/leandro/LE-03/reconcile.mjs')
  expect(io.send.mock.calls[0][0].input).toEqual({ Bucket: 'receipts-test', Key: 'synthetic-key' }); expect(io.send.mock.calls[0][1].abortSignal).toBeInstanceOf(AbortSignal)
  expect(io.end).toHaveBeenCalledOnce(); expect(io.destroy).toHaveBeenCalledOnce(); expect(process.exitCode).toBe(0)
})
it.each(['invalid_reference', 'cleanup_failed', 'database_error', 'state_unknown'])('returns nonzero status for reconciliation result %s', async status => {
  reconciliationEnv(); args('--company-id', id); io.reconcile.mockResolvedValue({ items: [{ status }] }); await import('../../../scripts/leandro/LE-03/reconcile.mjs'); expect(process.exitCode).toBe(1)
})
it.each([['--apply', '--dry-run'], ['--unknown'], ['--limit'], ['--limit', '2', '--limit', '3'], ['--limit', 'not-numeric']].map(values => ({ values })))('rejects invalid reconciliation flags $values', async ({ values }) => {
  reconciliationEnv(); args(...values); await import('../../../scripts/leandro/LE-03/reconcile.mjs'); expect(process.exitCode).toBe(2); expect(io.pool).not.toHaveBeenCalled()
})
it.each(['settings', 'database', 'shutdown'])('redacts reconciliation failure for %s and releases opened resources', async fault => {
  reconciliationEnv(); args('--company-id', id)
  if (fault === 'settings') vi.stubEnv('S3_BUCKET', undefined)
  if (fault === 'database') io.reconcile.mockRejectedValue(new Error('private-test-secret'))
  if (fault === 'shutdown') io.end.mockRejectedValue(new Error('private-test-secret'))
  await import('../../../scripts/leandro/LE-03/reconcile.mjs')
  expect(process.exitCode).toBe(fault === 'shutdown' ? 0 : 2); expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private-test-secret')
  if (fault !== 'settings') expect(io.destroy).toHaveBeenCalledOnce()
})

function adminQueries() {
  io.query.mockImplementation(async sql => ({ rows: sql.includes('current_role') ? [{ current_role: 'admin', login_role: 'admin', rolsuper: true }] : sql.startsWith('SELECT rolsuper') ? [{}] : sql.startsWith('SELECT format') ? [{ command: 'ALTER ROLE synthetic' }] : sql.includes('AS permitted') ? [{ permitted: true }] : sql.includes('INSERT INTO') ? [{ id: sql.includes('.companies') ? 'company-id' : 'first-hr-id' }] : [] }))
}
it.each(['web', 'notifications'])('provisions %s using private stdin, strips one newline and closes its admin connection', async role => {
  args('--apply'); input('p'.repeat(32) + '\r\n'); adminQueries()
  vi.stubEnv(role === 'web' ? 'HA04_ADMIN_DATABASE_URL' : 'HA09_ADMIN_DATABASE_URL', 'postgres://private-admin')
  if (role === 'web') await import('../../../scripts/rls/provision-runtime-cli.mjs')
  else await import('../../../scripts/notifications/provision-worker-cli.mjs')
  expect(io.query).toHaveBeenCalledWith(expect.stringContaining('SELECT format'), [role === 'web' ? 'expense_web' : 'expense_notifications', 'p'.repeat(32)])
  expect(io.end).toHaveBeenCalledOnce(); expect(process.exitCode).toBe(0); expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain('p'.repeat(32))
})
it.each(['web', 'notifications'].flatMap(role => ['flag', 'oversized', 'invalid-password', 'database'].map(fault => ({ role, fault }))))('rejects unsafe $role provisioning: $fault', async ({ role, fault }) => {
  args(fault === 'flag' ? '--unsafe' : '--apply'); input(fault === 'oversized' ? 'p'.repeat(513) : fault === 'invalid-password' ? 'short' : 'p'.repeat(32)); adminQueries()
  vi.stubEnv(role === 'web' ? 'HA04_ADMIN_DATABASE_URL' : 'HA09_ADMIN_DATABASE_URL', 'postgres://private-admin')
  if (fault === 'database') io.connect.mockRejectedValue(new Error('private-admin'))
  if (role === 'web') await import('../../../scripts/rls/provision-runtime-cli.mjs'); else await import('../../../scripts/notifications/provision-worker-cli.mjs')
  expect(process.exitCode).toBe(1); expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private-admin')
})
const bootstrap = { companyName: 'Test company', companyDomain: 'company.test', name: 'First HR', email: 'hr@company.test', password: 'private-password' }
it.each(['success', 'invalid-json', 'oversized', 'fields', 'database', 'permission', 'missing-config'])('bootstrap CLI handles %s without echoing private input', async fault => {
  args('--apply'); vi.stubEnv('HA05_BOOTSTRAP_DATABASE_URL', fault === 'missing-config' ? undefined : 'postgres://private-admin'); adminQueries()
  input(fault === 'invalid-json' ? '{' : fault === 'oversized' ? 'x'.repeat(16385) : JSON.stringify(fault === 'fields' ? {} : bootstrap))
  if (fault === 'database') io.connect.mockRejectedValue(new Error('private-password'))
  if (fault === 'permission') io.query.mockResolvedValue({ rows: [{ permitted: false }] })
  await import('../../../scripts/hamza/enrollment-bootstrap-cli.mjs')
  await vi.waitFor(() => expect(fault === 'success' ? console.log : console.error).toHaveBeenCalled())
  if (fault === 'success') expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0][0]))).toEqual({ kind: 'company_bootstrapped', companyId: 'company-id', firstHrId: 'first-hr-id', next: 'sign_in' })
  else expect(process.exitCode).toBe(fault === 'missing-config' ? 2 : 1)
  expect(JSON.stringify([...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls])).not.toContain('private-password')
})
it.each(['missing', 'healthy', 'unsafe', 'database', 'end-failure'])('RLS inspector reports %s with a read-only transaction', async fault => {
  vi.stubEnv('DATABASE_URL', fault === 'missing' ? undefined : 'postgres://private-application')
  io.query.mockImplementation(async sql => ({ rows: sql.includes('FROM pg_roles WHERE rolname') ? [{ name: 'expense_web', superuser: fault === 'unsafe' }] : sql.includes('FROM pg_class') ? [{ name: 'users', enabled: true, policy_count: 1 }] : sql.includes('AS can_create') ? [{}] : [] }))
  if (fault === 'database') io.connect.mockRejectedValue(new Error('private-application'))
  if (fault === 'end-failure') io.end.mockRejectedValue(new Error('private-application'))
  await import('../../../scripts/check-rls-readiness.mjs')
  expect(process.exitCode).toBe(fault === 'missing' || fault === 'database' ? 2 : fault === 'unsafe' ? 1 : 0)
  if (fault !== 'missing' && fault !== 'database') { expect(io.query).toHaveBeenCalledWith('BEGIN READ ONLY'); expect(io.query).toHaveBeenCalledWith('COMMIT') }
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private-application')
})
