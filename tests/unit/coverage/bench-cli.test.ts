import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import path from 'node:path'
import { EventEmitter } from 'node:events'

const io = vi.hoisted(() => ({ files: new Map<string, string>(), faults: new Set<string>(), spawn: vi.fn(), command: vi.fn(), net: vi.fn(), query: vi.fn(), end: vi.fn(), release: vi.fn(), prepare: vi.fn(), context: vi.fn(), worker: vi.fn(), recognize: vi.fn(), terminate: vi.fn(), mkdir: vi.fn(), write: vi.fn(), remove: vi.fn(), hooks: vi.fn(), deregister: vi.fn() }))
vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>(),
  existsSync: (file: string) => io.files.has(String(file)),
  lstatSync: () => ({ isSymbolicLink: () => io.faults.has('symlink') }),
  mkdirSync: io.mkdir,
  readFileSync: (file: string) => {
    const name = String(file)
    if (name === '.nvmrc') return io.faults.has('version') ? '0.0.0' : process.version.slice(1)
    if (name.endsWith('images.json')) return JSON.stringify([{ id: 'receipt', lines: ['TOTAL 18,75 EUR', '28/10/2026'], expected: { amount: 18.75, expenseDate: '2026-10-28' } }])
    return io.files.get(name) ?? Buffer.from('versioned source or synthetic receipt')
  },
  writeFileSync: io.write, rmSync: io.remove,
}))
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn(), mkdtemp: vi.fn(async () => path.join(process.cwd(), '.ci-output', 'campaign')) }))
vi.mock('node:child_process', () => ({ spawn: io.spawn, spawnSync: io.command }))
vi.mock('node:net', () => ({ createServer: io.net }))
vi.mock('node:module', () => ({ registerHooks: io.hooks }))
vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn(async () => {}) }))
vi.mock('bcryptjs', () => ({ default: { hash: vi.fn(async () => 'synthetic-hash') } }))
vi.mock('pg', () => ({ Pool: class {
  role: string
  constructor(options: { connectionString: string }) { this.role = new URL(options.connectionString).username }
  query = (sql: string, values?: unknown[]) => io.query(this.role, sql, values)
  connect = async () => ({ query: this.query, release: io.release })
  end = io.end
} }))
vi.mock('@playwright/test', () => ({ request: { newContext: io.context } }))
vi.mock('tesseract.js', () => ({ createWorker: io.worker }))
// Database/schema preparation is a separate service operation; its guards stay real.
vi.mock('../../../tests/support/prepare.mjs', () => ({ prepare: io.prepare }))

const state = path.join(process.cwd(), '.ci-output/benchmark/active.json')
const marker = path.join(process.cwd(), '.ci-output/benchmark/private/benchmark.json')
const protocol = 'math05-v4-paged-runtime-20261025'
const originalArgv = process.argv, originalExit = process.exitCode
const listeners = new Map<NodeJS.Signals, Set<NodeJS.SignalsListener>>()
let child: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; exitCode: number | null; pid: number }
const config = () => JSON.parse(io.files.get(state)!)
function fixture() {
  const password = 'a'.repeat(40), project = 'arla-ci-bench-abc123abc123'
  const env: Record<string, string> = { ARLA_TEST_ENV: 'isolated', ARLA_TEST_PROJECT: project, ARLA_TEST_BASE_URL: 'http://127.0.0.1:3210', ARLA_TEST_DB_PORT: '55440', ARLA_TEST_S3_PORT: '45740', HA01_TEST_PORT: '3211', POSTGRES_USER: 'expense_test', POSTGRES_DB: 'expense_io_test', POSTGRES_PASSWORD: password, DATABASE_URL: `postgres://expense_test:${password}@127.0.0.1:55440/expense_io_test`, S3_ENDPOINT: 'http://127.0.0.1:45740', S3_BUCKET: 'receipts-ci-test', S3_REGION: 'us-east-1', S3_ACCESS_KEY_ID: 'test', S3_SECRET_ACCESS_KEY: 'test', S3_FORCE_PATH_STYLE: 'true', AUTH_SECRET: 'private-auth-secret' }
  for (const role of ['HR', 'MANAGER', 'EMPLOYEE']) { env[`ARLA_TEST_${role}_EMAIL`] = env[`SEED_${role}_EMAIL`] = `${role.toLowerCase()}@expense.test`; env[`ARLA_TEST_${role}_PASSWORD`] = env[`SEED_${role}_PASSWORD`] = password }
  return { id: 'abc123abc123', database: 'expense_io_test', project, databaseURL: env.DATABASE_URL, runtimeDatabaseURL: `postgres://expense_web:${'b'.repeat(40)}@127.0.0.1:55440/expense_io_test`, runtimePassword: 'b'.repeat(40), fixturePassword: 'private-fixture-password', baseURL: env.ARLA_TEST_BASE_URL, appPort: 3210, env }
}
const output = (name: string) => JSON.parse([...io.files].find(([file]) => file.endsWith(name))![1])
const execute = async (action: string, ...args: string[]) => { process.argv = [process.execPath, 'bench.mjs', action, ...args]; await import('../../../scripts/bench.mjs') }
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); io.files.clear(); io.faults.clear(); process.exitCode = 0
  for (const key of ['DOCKER_HOST', 'ARLA_TEST_ENV', 'ARLA_TEST_BASE_URL', 'DATABASE_URL', 'S3_ENDPOINT', 'S3_BUCKET']) vi.stubEnv(key, undefined)
  vi.stubEnv('npm_config_user_agent', 'npm/11.19.1 node/v24.22.1'); vi.stubEnv('npm_execpath', 'npm-cli.js')
  for (const signal of ['SIGINT', 'SIGTERM'] as const) listeners.set(signal, new Set(process.listeners(signal)))
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(process, 'kill').mockReturnValue(true)
  io.files.set(state, JSON.stringify(fixture())); io.files.set(marker, JSON.stringify({ protocol, runId: 'abc123abc123', volume: 1000, company: 'company', users: { EMPLOYEE: 'employee-id', MANAGER: 'manager-id', HR: 'hr-id' }, domain: 'bench.example.test', distribution: [], digest: 'digest' }))
  io.write.mockImplementation((file, text) => io.files.set(String(file), String(text))); io.remove.mockImplementation(file => io.files.delete(String(file)))
  io.hooks.mockReturnValue({ deregister: io.deregister })
  io.net.mockImplementation(() => { let error: () => void; const probe = { once: (_: string, cb: () => void) => { error = cb; return probe }, listen: (_: number, __: string, cb: () => void) => { if (io.faults.has('occupied')) error(); else cb() }, close: (cb: () => void) => cb() }; return probe })
  io.command.mockImplementation((exe: string, args: string[]) => {
    if (exe === 'git') return { status: io.faults.has('git') ? 1 : 0, stdout: args[0] === 'status' ? '' : 'c'.repeat(40) }
    if (exe !== 'docker') return { status: io.faults.has('build') ? 1 : 0 }
    if (io.faults.has('docker')) return { status: 1 }
    if (args[0] === 'context') return { status: 0, stdout: io.faults.has('remote') ? 'tcp://remote:2375' : 'unix:///var/run/docker.sock' }
    if (args[0] === 'ps') return { status: 0, stdout: io.faults.has('ownership') ? 'isolated foreign-project' : io.files.has(state) ? `isolated ${config().project}\nisolated ${config().project}` : '' }
    return { status: 0, stdout: '' }
  })
  io.query.mockImplementation(async (role: string, sql: string) => {
    if (io.faults.has('insert') && sql.startsWith('INSERT INTO companies')) throw Error('insert failed')
    if (sql.includes('current_database() AS database')) return { rows: [{ database: io.faults.has('identity') ? 'foreign_db' : 'expense_io_test', role, login: role }] }
    if (sql.includes('current_user AS current_role')) return { rows: [{ current_role: role, login_role: role, rolsuper: role === 'expense_test', memberships: 0 }] }
    if (sql.includes('has_database_privilege')) return { rows: [{ protected: 13 }] }
    if (sql.includes('WHERE rolname=$1')) return { rows: [{}] }
    if (sql.includes("format('ALTER ROLE")) return { rows: [{ command: 'ALTER ROLE expense_web' }] }
    if (sql.includes('SELECT count(*)::int AS count FROM expense_notes')) return { rows: [{ count: io.faults.has('visible') ? 1 : 0 }] }
    if (sql.includes('SELECT count(*) AS count')) return { rows: [{ count: io.faults.has('volume') ? 999 : 1000 }] }
    if (sql.includes(' AS digest')) return { rows: [{ digest: 'fixture-digest' }] }
    if (sql.includes('GROUP BY status')) return { rows: [{ status: 'pending', count: 700 }] }
    if (sql.startsWith('EXPLAIN')) return { rows: [{ 'QUERY PLAN': [{ Plan: 'synthetic' }] }] }
    if (sql.startsWith('WITH filtered')) return { rows: [{ items: [], total_count: '1000', total_cents: '1875000' }] }
    return { rows: [] }
  })
  child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null as number | null, pid: 987654 })
  io.spawn.mockReturnValue(child)
  vi.stubGlobal('fetch', vi.fn(async () => { if (io.faults.has('not-ready')) throw Error('not ready'); child.stdout.emit('data', `safe log ${config().env.AUTH_SECRET} ${config().databaseURL} authjs.session-token=cookie-secret`); return { status: 200 } }))
  io.context.mockImplementation(async () => {
    let role = ''
    return { dispose: vi.fn(async () => {}), post: vi.fn(async (_: string, options: { form: { email: string } }) => { role = options.form.email.split('@')[0]; return { status: () => io.faults.has('login') ? 401 : 302 } }),
      get: vi.fn(async (route: string) => {
        if (route.endsWith('/csrf')) return { json: async () => ({ csrfToken: 'csrf' }) }
        if (route.endsWith('/session')) return { json: async () => ({ user: { id: `${role}-id` } }) }
        const count = role === 'employee' ? 500 : role === 'manager' ? 400 : 300
        return { status: () => role ? 200 : io.faults.has('anonymous') ? 200 : 401, body: async () => Buffer.from(JSON.stringify({ items: Array.from({ length: io.faults.has('rows') ? 99 : 100 }, () => ({})), pagination: { page: 1, pageSize: 100, totalItems: count }, totals: { count, scope: 'filtered', amount: 1875 } })), dispose: vi.fn(async () => {}) }
      }),
    }
  })
  io.worker.mockImplementation(async () => { if (io.faults.has('ocr-init')) throw Error('OCR unavailable'); return { recognize: io.recognize, terminate: io.terminate } })
  io.recognize.mockImplementation(async () => { if (io.faults.has('ocr-failure')) throw Error('recognition failed'); return { data: { text: io.faults.has('ocr-wrong') ? 'unreadable' : 'TOTAL 18,75 EUR\n28/10/2026' } } })
})
afterEach(() => {
  for (const [signal, before] of listeners) for (const fn of process.listeners(signal)) if (!before.has(fn)) process.removeListener(signal, fn)
  process.argv = originalArgv; process.exitCode = originalExit; vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals()
})

it('prepares an owned fixture, provisions a restricted web login and builds without maintenance credentials', async () => {
  io.files.delete(state); await execute('prepare', '1000')
  expect(process.exitCode).toBe(0); expect(output('benchmark.json')).toMatchObject({ volume: 1000, digest: 'fixture-digest', protocol })
  expect(io.query.mock.calls.filter(([, sql]) => sql.startsWith('INSERT INTO users'))).toHaveLength(3)
  const build = io.command.mock.calls.find(([exe]) => exe === process.execPath)!
  expect(build[2].env.DATABASE_URL).toContain('expense_web:'); expect(build[2].env.POSTGRES_PASSWORD).toBeUndefined()
  expect(io.files.has(state)).toBe(true); expect(io.end).toHaveBeenCalledTimes(2)
})
it('runs authenticated bounded pagination and OCR measurements and retains redacted evidence before cleanup', async () => {
  await execute('run')
  expect(process.exitCode).toBe(0); expect(output('outcome.json')).toMatchObject({ outcome: 'passed', expired: false, httpAttempts: 280, sqlPlans: 9, realOcrRecognitions: 3 })
  expect(output('summary.json').lists.map((x: { all: { attempts: number; errors: number } }) => x.all)).toEqual(Array.from({ length: 3 }, () => expect.objectContaining({ attempts: 90, errors: 0 })))
  expect(output('conditions.json').webEnvironment).toEqual({ maintenanceCredentials: false, bootstrapException: false })
  expect(output('ocr.json').filter((x: { correct?: boolean }) => x.correct)).toHaveLength(3)
  expect(io.terminate).toHaveBeenCalledTimes(3); expect(io.files.has(state)).toBe(false)
  const logs = [...io.files].find(([file]) => file.endsWith('server.log'))![1]
  expect(logs).toContain('[REDACTED]'); expect(logs).not.toMatch(/private-auth-secret|cookie-secret|postgres:\/\//)
  expect(process.kill).toHaveBeenCalledWith(-child.pid, 'SIGTERM'); expect(process.kill).toHaveBeenCalledWith(-child.pid, 'SIGKILL')
})
it.each(['anonymous', 'login', 'rows', 'ocr-init', 'ocr-failure', 'ocr-wrong', 'not-ready'])('retains failed campaign diagnostics and cleans only its stack: %s', async fault => {
  io.faults.add(fault); await execute('run')
  expect(process.exitCode).toBe(1); expect(output('outcome.json').outcome).toBe('failed'); expect(io.files.has(state)).toBe(false)
  expect(io.files.keys().toArray().some(file => file.endsWith('http.json'))).toBe(true)
  if (fault === 'rows') expect(output('summary.json').lists[0].all.errors).toBe(90)
  if (fault === 'ocr-failure') expect(io.terminate).toHaveBeenCalledOnce()
})
it.each(['symlink', 'remote', 'ownership', 'version', 'identity', 'visible', 'volume', 'docker', 'git'])('refuses unsafe or inconsistent campaign input: %s', async fault => {
  io.faults.add(fault); await execute('run')
  expect(process.exitCode).toBe(1); expect(io.spawn).not.toHaveBeenCalled(); expect(console.error).toHaveBeenCalled()
})
it.each(['occupied', 'insert', 'build'])('cleans an incomplete preparation without hiding its failure: %s', async fault => {
  io.files.delete(state); io.faults.add(fault); await execute('prepare', '1000')
  expect(process.exitCode).toBe(1); expect(io.files.has(state)).toBe(false)
  if (fault === 'insert') expect(io.query).toHaveBeenCalledWith('expense_test', 'ROLLBACK', undefined)
})
it.each([['prepare', '42'], ['prepare', '1000'], ['unknown']])('rejects invalid or already-active preparation %j', async (...args) => {
  await execute(args[0], ...args.slice(1)); expect(process.exitCode).toBe(1); expect(io.prepare).not.toHaveBeenCalled(); expect(io.command).not.toHaveBeenCalled()
})
it('requires consistent metadata and ignores no conflicting external target', async () => {
  vi.stubEnv('DATABASE_URL', 'postgres://foreign'); await execute('down'); expect(process.exitCode).toBe(1); expect(io.remove).not.toHaveBeenCalled(); expect(io.command).not.toHaveBeenCalled()
})
it('explicitly tears down the owned stack while retaining its fixture evidence', async () => {
  await execute('down'); expect(process.exitCode).toBe(0); expect(io.files.has(state)).toBe(false); expect(io.files.has(marker)).toBe(true)
  expect(io.command).toHaveBeenCalledWith('docker', expect.arrayContaining(['down', '--volumes', '--remove-orphans']), expect.anything())
})
