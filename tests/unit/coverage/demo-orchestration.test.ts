import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import path from 'node:path'
import { EventEmitter } from 'node:events'

const io = vi.hoisted(() => ({ files: new Map<string, string>(), faults: new Set<string>(), command: vi.fn(), net: vi.fn(), query: vi.fn(), end: vi.fn(), release: vi.fn(), prepare: vi.fn(), spawn: vi.fn(), stop: vi.fn(), write: vi.fn(), remove: vi.fn(), mkdir: vi.fn() }))
vi.mock('node:fs', () => ({
  existsSync: (file: string) => io.files.has(String(file)) || io.faults.has('directory-symlink'),
  lstatSync: (file: string, options?: { throwIfNoEntry?: boolean }) => {
    if (io.files.has(String(file)) || io.faults.has('directory-symlink')) return { isSymbolicLink: () => io.faults.has('symlink') || io.faults.has('directory-symlink'), isFile: () => !io.faults.has('not-file'), mode: io.faults.has('permissions') ? 0o644 : 0o600 }
    if (options?.throwIfNoEntry === false) return undefined
    throw Object.assign(Error('private file absent'), { code: 'ENOENT' })
  },
  mkdirSync: io.mkdir,
  readFileSync: (file: string) => String(file) === '.nvmrc' ? io.faults.has('version') ? '0.0.0' : process.version.slice(1) : io.files.get(String(file)),
  writeFileSync: io.write, rmSync: io.remove,
}))
vi.mock('node:child_process', () => ({ spawnSync: io.command }))
vi.mock('node:net', () => ({ default: { createServer: io.net } }))
vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn(async () => {}) }))
vi.mock('pg', () => ({ Pool: class { query = io.query; connect = async () => ({ query: io.query, release: io.release }); end = io.end } }))
// These boundaries provision the disposable services and own a subprocess tree.
vi.mock('../../../tests/support/prepare.mjs', () => ({ prepare: io.prepare }))
vi.mock('../../../tests/support/process-tree.mjs', () => ({ spawnOwnedNodeProcess: io.spawn, stopOwnedNodeProcess: io.stop }))

const state = path.resolve('.ci-output/demo/runtime.json'), seed = path.resolve('.ci-output/demo/seed.json')
const originalArgv = process.argv, originalExit = process.exitCode, platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const handlers = new Map<string, (...args: unknown[]) => void>()
let child: { stdout: EventEmitter; stderr: EventEmitter; exitCode: number | null; signalCode: string | null; pid: number; once: ReturnType<typeof vi.fn> }
const config = () => JSON.parse(io.files.get(state)!)
function fixture() {
  const password = 'a'.repeat(40), project = 'arla-ci-demo-abc123abc123'
  const env: Record<string, string> = { ARLA_TEST_ENV: 'isolated', ARLA_TEST_PROJECT: project, ARLA_TEST_BASE_URL: 'http://127.0.0.1:3215', ARLA_TEST_DB_PORT: '55440', ARLA_TEST_S3_PORT: '45740', HA01_TEST_PORT: '3216', POSTGRES_USER: 'expense_test', POSTGRES_DB: 'expense_io_test', POSTGRES_PASSWORD: password, DATABASE_URL: `postgres://expense_test:${password}@127.0.0.1:55440/expense_io_test`, S3_ENDPOINT: 'http://127.0.0.1:45740', S3_BUCKET: 'receipts-ci-test', S3_REGION: 'us-east-1', S3_ACCESS_KEY_ID: 'test', S3_SECRET_ACCESS_KEY: 'test', S3_FORCE_PATH_STYLE: 'true', AUTH_SECRET: 'private-demo-secret' }
  for (const role of ['HR', 'MANAGER', 'EMPLOYEE']) { env[`ARLA_TEST_${role}_EMAIL`] = env[`SEED_${role}_EMAIL`] = `${role.toLowerCase()}@expense.test`; env[`ARLA_TEST_${role}_PASSWORD`] = env[`SEED_${role}_PASSWORD`] = password }
  return { project, env, webURL: `postgres://expense_web:${'b'.repeat(40)}@127.0.0.1:55440/expense_io_test` }
}
const execute = async (action: string, ...args: string[]) => { process.argv = [process.execPath, 'demo.mjs', action, ...args]; await import('../../../scripts/mathis/MATH-03/demo.mjs') }
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); io.files.clear(); io.faults.clear(); handlers.clear(); process.exitCode = 0
  vi.stubEnv('DOCKER_HOST', undefined); vi.stubEnv('npm_config_user_agent', 'npm/11.19.1 node/v24.22.1'); vi.stubEnv('npm_execpath', 'npm-cli.js')
  vi.spyOn(console, 'info').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(process, 'kill').mockReturnValue(true)
  const realOn = process.on.bind(process)
  vi.spyOn(process, 'on').mockImplementation((event, listener) => {
    if (typeof event === 'string' && ['SIGINT', 'SIGTERM', 'SIGHUP', 'exit'].includes(event)) { handlers.set(event, listener); return process }
    return realOn(event, listener)
  })
  io.files.set(state, JSON.stringify(fixture())); io.files.set(seed, JSON.stringify({ private: 'seed' }))
  io.write.mockImplementation((file, text) => io.files.set(String(file), String(text))); io.remove.mockImplementation(file => io.files.delete(String(file)))
  io.net.mockImplementation(() => { let error: () => void; const probe = { once: (_: string, cb: () => void) => { error = cb; return probe }, listen: (_: number, __: string, cb: () => void) => { if (io.faults.has('occupied')) error(); else cb() }, close: (cb: () => void) => cb() }; return probe })
  io.command.mockImplementation((exe: string, args: string[]) => {
    if (exe !== 'docker') return { status: io.faults.has('build') ? 1 : 0 }
    if (io.faults.has('docker')) return { status: 1 }
    if (args[0] === 'context') return { status: 0, stdout: io.faults.has('remote') ? 'tcp://remote:2375' : io.faults.has('npipe') ? 'npipe:////./pipe/docker_engine' : 'unix:///var/run/docker.sock' }
    if (args[0] === 'ps') return { status: 0, stdout: io.faults.has('ownership') ? 'isolated foreign-project' : io.files.has(state) ? `isolated ${config().project}\nisolated ${config().project}` : '' }
    return { status: 0, stdout: '' }
  })
  io.query.mockImplementation(async (sql: string) => {
    if (sql.includes('current_user AS current_role')) return { rows: [{ current_role: 'expense_test', login_role: 'expense_test', rolsuper: true }] }
    if (sql.includes('WHERE rolname=$1')) return { rows: [{}] }
    if (sql.includes("format('ALTER ROLE")) return { rows: [{ command: 'ALTER ROLE expense_web' }] }
    return { rows: [] }
  })
  child = { stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null, signalCode: null, pid: 987654, once: vi.fn((_: string, cb: () => void) => { child.exitCode = 0; cb() }) }
  io.spawn.mockReturnValue(child)
  io.stop.mockImplementation(async () => { child.exitCode = 0; if (io.faults.has('stop')) throw Error('driver secret') })
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (io.faults.has('signals')) { handlers.get('SIGINT')!(); handlers.get('SIGTERM')!() }
    if (io.faults.has('exit-signal')) handlers.get('exit')!()
    if (io.faults.has('not-ready')) throw Error('connection refused')
    return { ok: true }
  }))
})
afterEach(() => { process.argv = originalArgv; process.exitCode = originalExit; Object.defineProperty(process, 'platform', platform); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

it('prepares private configuration and provisions a restricted production process', async () => {
  io.files.clear(); await execute('prepare')
  expect(process.exitCode).toBe(0); const saved = config(), seedConfig = JSON.parse(io.files.get(seed)!)
  expect(saved.project).toMatch(/^arla-ci-demo-[a-f0-9]{12}$/); expect(seedConfig).toMatchObject({ SEED_CONFIRM_DATABASE: 'expense_io_test', SEED_DEMO_ENV: 'local-test', SEED_ADMIN_DATABASE_URL: saved.env.DATABASE_URL })
  expect(io.write).toHaveBeenCalledWith(state, expect.any(String), { mode: 0o600, flag: 'wx' }); expect(io.write).toHaveBeenCalledWith(seed, expect.any(String), { mode: 0o600, flag: 'wx' })
  const build = io.command.mock.calls.find(([exe]) => exe === process.execPath)!
  expect(build[2].env.DATABASE_URL).toBe(saved.webURL); expect(build[2].env.POSTGRES_PASSWORD).toBeUndefined(); expect(build[2].env.SEED_ADMIN_DATABASE_URL).toBeUndefined()
  expect(io.end).toHaveBeenCalledOnce(); expect(io.release).toHaveBeenCalledOnce(); expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(saved.env.POSTGRES_PASSWORD)
})
it.each(['unix', 'npipe'])('starts the guarded demo using only its runtime credentials over %s Docker', async socket => {
  if (socket === 'npipe') { io.faults.add('npipe'); vi.stubEnv('DOCKER_HOST', 'npipe:////./pipe/docker_engine') }
  await execute('start')
  expect(process.exitCode).toBe(0); expect(io.spawn).toHaveBeenCalledWith(expect.arrayContaining(['start', '--port', '3215']), expect.objectContaining({ env: expect.objectContaining({ DATABASE_URL: fixture().webURL, NODE_ENV: 'production' }) }))
  expect(io.spawn.mock.calls[0][1].env.POSTGRES_PASSWORD).toBeUndefined(); expect(io.files.has(seed)).toBe(true); expect(child.once).toHaveBeenCalledWith('exit', expect.any(Function))
})
it('coalesces repeated termination signals into one stop of the owned process', async () => {
  io.faults.add('signals'); await execute('start')
  expect(io.stop).toHaveBeenCalledOnce(); expect(process.exitCode).toBe(0); expect(io.files.has(state)).toBe(true)
})
it('reports a failed process stop without throwing secret driver output', async () => {
  io.faults.add('signals'); io.faults.add('stop'); await execute('start')
  expect(io.stop).toHaveBeenCalledOnce(); expect(process.exitCode).toBe(1); expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('driver secret')
})
it('terminates only its own process group when a Unix parent exits', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true }); io.faults.add('exit-signal'); await execute('start')
  expect(process.kill).toHaveBeenCalledWith(-child.pid, 'SIGTERM'); expect(process.exitCode).toBe(0)
})
it('stops an unready child and preserves its demo data for recovery', async () => {
  io.faults.add('not-ready'); await execute('start')
  expect(process.exitCode).toBe(1); expect(io.stop).toHaveBeenCalledWith(child); expect(io.files.has(state)).toBe(true); expect(console.error).toHaveBeenCalledWith('Restricted demo server did not become ready.')
})
it.each(['down', 'reset'])('requires explicit confirmation before %s', async action => {
  await execute(action); expect(process.exitCode).toBe(1); expect(io.command).not.toHaveBeenCalled(); expect(io.remove).not.toHaveBeenCalled()
})
it('removes only confirmed owned demo files and volumes even if no seed was written', async () => {
  io.files.delete(seed); await execute('down', '--confirm-disposable')
  expect(process.exitCode).toBe(0); expect(io.files.has(state)).toBe(false); expect(io.remove).toHaveBeenCalledWith(seed, { force: true })
  expect(io.command).toHaveBeenCalledWith('docker', expect.arrayContaining(['compose', '-p', fixture().project, 'down', '--volumes', '--remove-orphans']), expect.anything())
})
it('resets a confirmed disposable stack with fresh credentials', async () => {
  await execute('reset', '--confirm-disposable')
  expect(process.exitCode).toBe(0); expect(config().project).not.toBe(fixture().project); expect(config().env.POSTGRES_PASSWORD).not.toBe(fixture().env.POSTGRES_PASSWORD); expect(io.prepare).toHaveBeenCalledOnce()
})
it.each(['version', 'remote', 'ownership', 'docker', 'symlink', 'not-file', 'occupied', 'directory-symlink'])('refuses an unsafe demo start: %s', async fault => {
  io.faults.add(fault); await execute('start')
  expect(process.exitCode).toBe(1); expect(io.spawn).not.toHaveBeenCalled(); expect(io.remove).not.toHaveBeenCalled()
})
it('requires private configuration permissions on Unix', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true }); io.faults.add('permissions'); await execute('start')
  expect(process.exitCode).toBe(1); expect(console.error).toHaveBeenCalledWith('Private demo configuration required.'); expect(io.spawn).not.toHaveBeenCalled()
})
it.each(['project', 'database'])('rejects contradictory %s metadata before service access', async fault => {
  const saved = config(); if (fault === 'project') saved.project = 'arla-ci-demo-ffffffffffff'; else saved.webURL = saved.env.DATABASE_URL
  io.files.set(state, JSON.stringify(saved)); await execute('start')
  expect(process.exitCode).toBe(1); expect(io.command).not.toHaveBeenCalled(); expect(io.spawn).not.toHaveBeenCalled()
})
it('rejects a remote inherited Docker host even when the current context is local', async () => {
  vi.stubEnv('DOCKER_HOST', 'tcp://remote:2375'); await execute('start'); expect(process.exitCode).toBe(1); expect(io.spawn).not.toHaveBeenCalled()
})
it.each(['build', 'prepare', 'cleanup'])('cleans an incomplete preparation or reports retained recovery state: %s', async fault => {
  io.files.clear()
  if (fault === 'build') io.faults.add('build')
  else io.prepare.mockImplementation(async () => { if (fault === 'cleanup') io.faults.add('occupied'); throw Error('driver secret') })
  await execute('prepare'); expect(process.exitCode).toBe(1); expect(io.files.has(state)).toBe(fault === 'cleanup')
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('driver secret')
  if (fault === 'cleanup') expect(console.error).toHaveBeenCalledWith('Owned cleanup incomplete; use demo:down with its explicit confirmation.')
})
it.each([['prepare'], ['prepare', 'unexpected'], ['start', 'unexpected'], ['down', '--confirm-disposable', 'extra'], ['unknown']])('does not overwrite private files for invalid input %j', async (...args) => {
  await execute(args[0], ...args.slice(1)); expect(process.exitCode).toBe(1); expect(io.write).not.toHaveBeenCalled(); expect(io.remove).not.toHaveBeenCalled(); expect(io.spawn).not.toHaveBeenCalled()
})
