import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough, Readable, Writable } from 'node:stream'
import { newDemo, sha256 } from '../../../scripts/mathis/MATH-06/guards.mjs'
import { command, database, databaseSnapshot, dump, localDocker, objects, ownedContainers, receipt, restoreDump, storage, vacant } from '../../../scripts/mathis/MATH-06/services.mjs'
const io = vi.hoisted(() => ({ exec: vi.fn(), spawn: vi.fn(), stream: vi.fn(), stat: vi.fn(), read: vi.fn(), createServer: vi.fn(), pool: vi.fn(), s3: vi.fn() }))
vi.mock('node:child_process', async () => { const { promisify } = await import('node:util'); return { execFile: Object.assign(vi.fn(), { [promisify.custom]: io.exec }), spawn: io.spawn } })
vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>(), createWriteStream: io.stream }))
vi.mock('node:fs/promises', async original => ({ ...await original<typeof import('node:fs/promises')>(), stat: io.stat, readFile: io.read }))
vi.mock('node:net', () => ({ default: { createServer: io.createServer } }))
vi.mock('pg', () => ({ Pool: class { constructor(options: unknown) { io.pool(options) } } }))
vi.mock('@aws-sdk/client-s3', async original => ({ ...await original<typeof import('@aws-sdk/client-s3')>(), S3Client: class { constructor(options: unknown) { io.s3(options) } } }))
const config = newDemo({ app: 3215, auth: 3216, db: 55440, s3: 45740 })
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('DOCKER_HOST', ''); io.exec.mockResolvedValue({ stdout: 'unix:///var/run/docker.sock' }) })
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })
function containers() {
  return ['postgres', 'localstack'].map((service, i) => ({ Id: service, Config: { Labels: { 'com.docker.compose.service': service, 'com.docker.compose.project': config.project, 'arla.test.environment': 'isolated', 'arla.test.project': config.project } }, State: { Running: true, Health: { Status: 'healthy' } }, NetworkSettings: { Ports: { [i ? '4566/tcp' : '5432/tcp']: [{ HostIp: '127.0.0.1', HostPort: i ? '45740' : '55440' }] } } }))
}
it('suppresses subprocess output on failure', async () => { io.exec.mockRejectedValue(new Error('private password')); await expect(command('docker', [])).rejects.toThrow('child_operation_failed_output_suppressed') })
it.each(['unix:///var/run/docker.sock', 'npipe:////./pipe/docker_engine'])('accepts local Docker transport %s', async endpoint => { io.exec.mockResolvedValue({ stdout: endpoint }); await expect(localDocker(config)).resolves.toBeUndefined() })
it.each(['endpoint', 'environment'])('refuses remote Docker from %s', async source => {
  if (source === 'endpoint') io.exec.mockResolvedValue({ stdout: 'tcp://remote:2375' }); else vi.stubEnv('DOCKER_HOST', 'tcp://remote:2375')
  await expect(localDocker(config)).rejects.toThrow('local_docker_socket_required')
})
it('validates the complete service identity and loopback port bindings', async () => {
  io.exec.mockResolvedValueOnce({ stdout: 'db s3' }).mockResolvedValueOnce({ stdout: JSON.stringify(containers()) })
  expect(await ownedContainers(config)).toEqual({ postgres: 'postgres', localstack: 'localstack' })
})
it.each(['missing', 'foreign', 'unhealthy', 'public-port'])('refuses %s containers', async fault => {
  const items = containers()
  if (fault === 'foreign') items[0].Config.Labels['arla.test.project'] = 'foreign'
  if (fault === 'unhealthy') items[0].State.Health.Status = 'starting'
  if (fault === 'public-port') items[0].NetworkSettings.Ports['5432/tcp'][0].HostIp = '0.0.0.0'
  io.exec.mockResolvedValueOnce({ stdout: fault === 'missing' ? 'db' : 'db s3' }).mockResolvedValueOnce({ stdout: JSON.stringify(items) })
  await expect(ownedContainers(config)).rejects.toThrow(fault === 'missing' ? 'two_owned_services_required' : 'service_identity_or_loopback_mismatch')
})
it.each([false, true])('requires a vacant container/volume/network namespace (occupied=%s)', async occupied => {
  io.exec.mockResolvedValue({ stdout: '' }); if (occupied) io.exec.mockResolvedValueOnce({ stdout: 'db' })
  if (occupied) await expect(ownedContainers(config, true)).rejects.toThrow('existing_target_refused')
  else await expect(ownedContainers(config, true)).resolves.toBeUndefined()
})
it.each([false, true])('checks port availability without stopping listeners (occupied=%s)', async occupied => {
  const server = new EventEmitter() as EventEmitter & { listen: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }
  server.listen = vi.fn((_port, _host, ready) => { if (occupied) server.emit('error', new Error('occupied')); else ready() }); server.close = vi.fn(done => done())
  io.createServer.mockReturnValue(server)
  if (occupied) await expect(vacant(3215)).rejects.toThrow('no process was stopped')
  else await expect(vacant(3215)).resolves.toBeUndefined()
})
it('builds bounded database and S3 clients for the supplied target', () => {
  database(config); storage(config)
  expect(io.pool).toHaveBeenCalledWith(expect.objectContaining({ connectionString: config.env.DATABASE_URL, max: 1, query_timeout: 12000 }))
  expect(io.s3).toHaveBeenCalledWith(expect.objectContaining({ endpoint: config.env.S3_ENDPOINT, maxAttempts: 1, forcePathStyle: true }))
})
it('collects and sorts all pages of a bounded object inventory', async () => {
  const send = vi.fn().mockResolvedValueOnce({ Contents: [{ Key: 'receipts/z' }], IsTruncated: true, NextContinuationToken: 'next' }).mockResolvedValueOnce({ Contents: [{ Key: 'receipts/a' }] })
  expect(await objects(config, { send })).toEqual([{ Key: 'receipts/a' }, { Key: 'receipts/z' }])
  expect(send.mock.calls[1][0].input.ContinuationToken).toBe('next')
})
it.each(['limit', 'loop', 'empty'])('handles inventory %s', async fault => {
  const send = vi.fn().mockResolvedValue(fault === 'limit' ? { Contents: Array.from({ length: 1001 }, () => ({ Key: 'x' })) } : fault === 'loop' ? { IsTruncated: true, NextContinuationToken: 'same' } : {})
  if (fault === 'empty') expect(await objects(config, { send })).toEqual([])
  else await expect(objects(config, { send })).rejects.toThrow(fault === 'limit' ? 'demo_object_limit' : 'storage_pagination_did_not_advance')
})
it.each(['key', 'type', 'length', 'incomplete', 'too-large'])('refuses receipt %s failures', async fault => {
  const body = Readable.from([Buffer.alloc(fault === 'too-large' ? 10 * 1024 * 1024 + 1 : 3)])
  const s3 = { send: vi.fn(async () => ({ ContentType: fault === 'type' ? 'text/html' : 'image/png', ContentLength: fault === 'length' ? 0 : fault === 'incomplete' ? 4 : 3, Body: body })) }
  await expect(receipt(config, s3, fault === 'key' ? '../secret' : 'receipts/test.png')).rejects.toThrow()
  if (fault === 'key') expect(s3.send).not.toHaveBeenCalled(); else expect(body.destroyed).toBe(true)
})
it.each(['ok', 'schema', 'rows', 'accounts', 'company'])('checks snapshot invariants: %s', async fault => {
  const query = vi.fn(async (sql: string) => ({ rows: sql.includes('pg_tables') ? [{ tablename: fault === 'schema' ? 'unsafe-name' : 'users' }] : sql.includes('row_to_json') ? [{ count: fault === 'rows' ? 10001 : 3, digest: 'digest' }] : sql.includes('SELECT email') ? (fault === 'accounts' ? [] : ['employee', 'hr', 'manager'].map(x => ({ email: `${x}@expense.test`, role: x === 'hr' ? 'hr_admin' : x, is_active: true }))) : sql.includes('FROM companies') ? [{ count: fault === 'company' ? 1 : 0 }] : [{ receipt_key: 'receipts/one.png' }] }))
  if (fault === 'ok') expect(await databaseSnapshot({ query })).toEqual({ tables: { users: { count: 3, digest: 'digest' } }, accounts: 3, receiptReferences: ['receipts/one.png'] })
  else await expect(databaseSnapshot({ query })).rejects.toThrow()
})
it.each([false, true])('streams a database archive and restores it (failure=%s)', async failure => {
  const bytes = Buffer.from('archive'), chunks: Buffer[] = []
  io.stream.mockImplementation(() => new Writable({ write(chunk, _encoding, done) { chunks.push(chunk); done() } }))
  io.stat.mockResolvedValue({ size: bytes.length }); io.read.mockResolvedValue(bytes)
  io.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: Readable.from([bytes]), stdin: new PassThrough(), stderr: Readable.from([]), exitCode: null as number | null, kill: vi.fn() })
    child.stdin.resume()
    setImmediate(() => { child.exitCode = failure ? 1 : 0; child.emit('exit', child.exitCode) })
    return child
  })
  if (failure) await expect(restoreDump(config, 'owned', bytes)).rejects.toThrow('Binary Docker operation failed')
  else {
    expect(await dump(config, 'owned', 'snapshot', 'test.dump')).toEqual({ bytes: bytes.length, sha256: sha256(bytes) })
    expect(Buffer.concat(chunks)).toEqual(bytes)
    await expect(restoreDump(config, 'owned', bytes)).resolves.toBeUndefined()
  }
})
