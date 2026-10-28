import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import path from 'node:path'
const io = vi.hoisted(() => ({ read: vi.fn(), stat: vi.fn(), backup: vi.fn(), restore: vi.fn(), prepare: vi.fn(), down: vi.fn(), doctor: vi.fn(), bucket: vi.fn(), seed: vi.fn(), end: vi.fn(), destroy: vi.fn(), pool: vi.fn(), register: vi.fn(), deregister: vi.fn() }))
vi.mock('node:fs', () => ({ readFileSync: io.read, lstatSync: io.stat }))
vi.mock('node:fs/promises', () => ({ readFile: async (...args: unknown[]) => io.read(...args), lstat: async (...args: unknown[]) => io.stat(...args) }))
vi.mock('node:module', () => ({ registerHooks: io.register }))
vi.mock('pg', () => ({ Pool: class { constructor(options: unknown) { io.pool(options) } end = io.end } }))
vi.mock('@aws-sdk/client-s3', () => ({ S3Client: class { destroy = io.destroy } }))
vi.mock('../../../scripts/mathis/MATH-06/transfer.mjs', () => ({ backup: io.backup, restore: io.restore, prepareDemo: io.prepare, downDemo: io.down }))
vi.mock('../../../scripts/mathis/MATH-06/doctor.mjs', () => ({ doctor: io.doctor }))
vi.mock('../../../scripts/mathis/MATH-03/storage.mjs', () => ({ ensureDemoBucket: io.bucket }))
vi.mock('../../../scripts/mathis/MATH-03/seed.ts', () => ({ runDemoSeed: io.seed }))
const originalArgv = process.argv, originalExit = process.exitCode
const configPath = path.resolve('.ci-output/fixture-private-config.json')
const config = { SEED_DEMO_ENV: 'local-test', SEED_CONFIRM_DATABASE: 'expense_io_test', SEED_ADMIN_DATABASE_URL: 'postgres://admin:private-password@127.0.0.1:55440/expense_io_test', S3_ENDPOINT: 'http://127.0.0.1:45740', S3_BUCKET: 'receipts-ci-test', S3_ACCESS_KEY_ID: 'synthetic', S3_SECRET_ACCESS_KEY: 'private-secret', SEED_HR_EMAIL: 'hr@company.test', SEED_MANAGER_EMAIL: 'manager@company.test', SEED_EMPLOYEE_EMAIL: 'employee@company.test' }
beforeEach(() => {
  vi.resetAllMocks(); vi.resetModules(); process.exitCode = 0
  vi.spyOn(console, 'info').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {})
  io.stat.mockReturnValue({ isFile: () => true, isSymbolicLink: () => false, size: 100, mode: 0o600 }); io.read.mockReturnValue(JSON.stringify(config))
  io.register.mockReturnValue({ deregister: io.deregister }); io.doctor.mockResolvedValue({ ok: true }); io.seed.mockResolvedValue({ status: 'ready' }); io.bucket.mockResolvedValue({ status: 'bucket-ready' })
  for (const operation of [io.backup, io.restore, io.prepare, io.down]) operation.mockResolvedValue({ status: 'completed' })
})
afterEach(() => { process.argv = originalArgv; process.exitCode = originalExit; vi.restoreAllMocks(); vi.unstubAllEnvs() })
it.each(['doctor', 'backup', 'restore', 'prepare', 'down'])('dispatches %s with its private config, confirmations and dedicated ports', async action => {
  const { operationsCli } = await import('../../../scripts/mathis/MATH-06/cli.mjs')
  const args = action === 'prepare' ? ['--output', 'destination', '--app-port', '3290'] : ['--config', configPath, ...(action === 'backup' ? ['--output', 'archive', '--confirm-stopped-synthetic'] : action === 'restore' ? ['--archive', 'archive', '--output', 'destination', '--db-port', '55490'] : action === 'down' ? ['--confirm-disposable'] : [])]
  await operationsCli(action, args)
  if (action === 'doctor') expect(io.doctor).toHaveBeenCalledWith(config)
  if (action === 'backup') expect(io.backup).toHaveBeenCalledWith(config, 'archive', true)
  if (action === 'restore') expect(io.restore).toHaveBeenCalledWith(config, 'archive', 'destination', { app: 3225, auth: 3226, db: '55490', s3: 45741 })
  if (action === 'prepare') expect(io.prepare).toHaveBeenCalledWith('destination', { app: '3290', auth: 3216, db: 55440, s3: 45740 })
  if (action === 'down') expect(io.down).toHaveBeenCalledWith(config, true)
  expect(process.exitCode).toBe(0)
})
it('uses doctor environment by default and propagates an unhealthy report as failure', async () => {
  io.doctor.mockResolvedValue({ ok: false, issues: ['not-running'] }); process.argv = [process.execPath, 'doctor.mjs']
  await import('../../../scripts/doctor.mjs')
  expect(io.doctor).toHaveBeenCalledWith(process.env); expect(process.exitCode).toBe(1); expect(String(vi.mocked(console.info).mock.calls[0][0])).toContain('not-running')
})
it.each([
  { action: 'unknown', args: [], code: 'unknown_operation' }, { action: 'prepare', args: ['--config', 'x'], code: 'unexpected_argument' },
  { action: 'prepare', args: ['--output', 'a', '--output', 'b'], code: 'unexpected_argument' }, { action: 'prepare', args: ['--output'], code: 'missing_argument' },
  { action: 'prepare', args: ['--output', '--db-port'], code: 'missing_argument' }, { action: 'backup', args: ['--config', 'relative.json'], code: 'absolute_private_config_required' },
])('rejects $action command with $code before mutation', async ({ action, args, code }) => {
  const { operationsCli } = await import('../../../scripts/mathis/MATH-06/cli.mjs'); await operationsCli(action, args)
  expect(process.exitCode).toBe(1); expect(console.error).toHaveBeenCalledWith(expect.stringContaining(code)); expect(io.prepare).not.toHaveBeenCalled(); expect(io.backup).not.toHaveBeenCalled()
})
it('suppresses private driver errors from command output', async () => {
  io.prepare.mockRejectedValue(new Error('postgres://admin:secret@example.test/db'))
  const { operationsCli } = await import('../../../scripts/mathis/MATH-06/cli.mjs'); await operationsCli('prepare', [])
  expect(process.exitCode).toBe(1); expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Private driver output was suppressed')); expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('admin:secret')
})
it.each(['backup', 'restore', 'operations'])('routes the %s executable through the validated CLI', async executable => {
  process.argv = [process.execPath, 'command.mjs', ...(executable === 'operations' ? ['prepare'] : []), '--output', 'destination']
  if (executable === 'backup') await import('../../../scripts/backup-demo.mjs')
  else if (executable === 'restore') await import('../../../scripts/restore-demo.mjs')
  else await import('../../../scripts/operations-demo.mjs')
  expect(executable === 'backup' ? io.backup : executable === 'restore' ? io.restore : io.prepare).toHaveBeenCalledOnce()
})
it.each(['init', 'repair', 'bucket'])('runs demo %s with validated synthetic identities and releases resources', async operation => {
  process.argv = [process.execPath, 'seed.mjs', '--config', configPath]
  if (operation === 'init') await import('../../../scripts/seed.mjs')
  else if (operation === 'repair') await import('../../../scripts/seed-repair.mjs')
  else await import('../../../scripts/ensure-bucket.mjs')
  expect(process.exitCode).toBe(0); expect(io.destroy).toHaveBeenCalledOnce()
  if (operation === 'bucket') { expect(io.bucket).toHaveBeenCalledWith(expect.objectContaining({ domain: 'company.test' }), expect.any(Object)); expect(io.pool).not.toHaveBeenCalled() }
  else { expect(io.seed).toHaveBeenCalledWith(expect.objectContaining({ domain: 'company.test' }), expect.objectContaining({ mode: operation })); expect(io.end).toHaveBeenCalledOnce(); expect(io.deregister).toHaveBeenCalledOnce() }
})
it('accepts explicit demo environment without falling back to web settings', async () => {
  for (const [name, value] of Object.entries(config)) vi.stubEnv(name, value)
  const { demoCli } = await import('../../../scripts/mathis/MATH-03/cli.mjs'); await demoCli('init', [])
  expect(io.pool).toHaveBeenCalledWith(expect.objectContaining({ connectionString: config.SEED_ADMIN_DATABASE_URL, max: 1 })); expect(io.read).not.toHaveBeenCalled()
})
it.each(['relative', 'unknown-arg', 'symlink', 'directory', 'settings', 'seed'])('refuses unsafe demo setup: %s', async fault => {
  if (fault === 'symlink') io.stat.mockReturnValue({ isFile: () => true, isSymbolicLink: () => true })
  if (fault === 'directory') io.stat.mockReturnValue({ isFile: () => false, isSymbolicLink: () => false })
  if (fault === 'settings') io.read.mockReturnValue('{}')
  if (fault === 'seed') io.seed.mockRejectedValue(new Error('private-password'))
  const { demoCli } = await import('../../../scripts/mathis/MATH-03/cli.mjs')
  await demoCli('init', fault === 'relative' ? ['--config', 'relative.json'] : fault === 'unknown-arg' ? ['--unknown', configPath] : ['--config', configPath])
  expect(process.exitCode).toBe(1); expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private-password')
  if (fault === 'seed') { expect(io.destroy).toHaveBeenCalledOnce(); expect(io.end).toHaveBeenCalledOnce() } else expect(io.seed).not.toHaveBeenCalled()
})
it('loads TypeScript with temporary scoped hooks, resolves aliases and delegates unrelated modules', async () => {
  const { seedImplementation } = await import('../../../scripts/mathis/MATH-03/load.mjs'); await seedImplementation()
  const hooks = io.register.mock.calls[0][0], next = vi.fn().mockReturnValue({ delegated: true }), context = {}
  hooks.resolve('@/domain/user', context, next); expect(next).toHaveBeenLastCalledWith(expect.stringMatching(/src\/domain\/user\.ts$/), context)
  hooks.resolve('@/lib/validation.ts', context, next); expect(next).toHaveBeenLastCalledWith(expect.stringMatching(/src\/lib\/validation\.ts$/), context)
  hooks.resolve('node:path', context, next); expect(next).toHaveBeenLastCalledWith('node:path', context)
  io.read.mockReturnValue('export const count: number = 3;')
  const ownUrl = new URL('../../../src/domain/user.ts', import.meta.url).href, loaded = hooks.load(ownUrl, context, next)
  expect(loaded).toMatchObject({ format: 'module', shortCircuit: true }); expect(loaded.source).toContain('export const count = 3'); expect(loaded.source).not.toContain(': number')
  expect(hooks.load('node:path', context, next)).toEqual({ delegated: true }); expect(io.deregister).toHaveBeenCalledOnce()
})
