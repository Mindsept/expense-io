import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { backup, downDemo, prepareDemo, restore } from '../../../scripts/mathis/MATH-06/transfer.mjs'
import { newDemo, privateRoot, sha256 } from '../../../scripts/mathis/MATH-06/guards.mjs'

const io = vi.hoisted(() => ({
  query: vi.fn(), connect: vi.fn(), release: vi.fn(), end: vi.fn(), destroy: vi.fn(),
  command: vi.fn(), docker: vi.fn(), localDocker: vi.fn(), ownedContainers: vi.fn(), vacant: vi.fn(), objects: vi.fn(), receipt: vi.fn(), snapshot: vi.fn(), dump: vi.fn(), restoreDump: vi.fn(), send: vi.fn(), prepare: vi.fn(), provision: vi.fn(), runner: vi.fn(), verify: vi.fn(), read: vi.fn(), write: vi.fn(), stat: vi.fn(), mkdir: vi.fn(),
}))
vi.mock('node:fs/promises', () => ({ readFile: io.read, writeFile: io.write, lstat: io.stat, mkdir: io.mkdir }))
vi.mock('../../../scripts/mathis/MATH-06/guards.mjs', async importOriginal => ({
  ...await importOriginal<typeof import('../../../scripts/mathis/MATH-06/guards.mjs')>(), schemaDigest: async () => 'b'.repeat(64), toolingDigest: async () => 'c'.repeat(64),
}))
vi.mock('../../../scripts/mathis/MATH-06/services.mjs', () => ({
  command: io.command, docker: io.docker, composeArgs: () => ['compose'], localDocker: io.localDocker, ownedContainers: io.ownedContainers, vacant: io.vacant,
  database: () => ({ connect: io.connect, query: io.query, end: io.end }), storage: () => ({ destroy: io.destroy }), send: io.send,
  objects: io.objects, receipt: io.receipt, databaseSnapshot: io.snapshot, dump: io.dump, restoreDump: io.restoreDump,
}))
vi.mock('pg', () => ({ Pool: class { query = async () => ({ rows: [{ role: 'expense_web', login: 'expense_web', rolsuper: false, rolbypassrls: false }] }); end = io.end } }))
vi.mock('node-pg-migrate', () => ({ runner: io.runner }))
vi.mock('../../../scripts/rls/provision-runtime.mjs', () => ({ provisionRuntime: io.provision }))
vi.mock('../../../tests/support/prepare.mjs', () => ({ prepare: io.prepare }))
vi.mock('../../../scripts/mathis/MATH-06/verify-http.mjs', () => ({ verifyHttp: io.verify, assertCleanAppConfiguration: async () => {} }))
const ports = { app: 3215, auth: 3216, db: 55440, s3: 45740 }, targetPorts = { app: 3225, auth: 3226, db: 55441, s3: 45741 }
const body = Buffer.from('synthetic-png'), dump = Buffer.from('synthetic-dump')
const objects = [1, 2].map(i => ({ key: `receipts/${i}.png`, bytes: body.length, sha256: sha256(body), contentType: 'image/png' }))
const state = { accounts: 3, tables: { users: { count: 3 }, expense_notes: { count: 2 } }, receiptReferences: objects.map(o => o.key) }
const manifest = { format: 'arla-math06-v1', status: 'exported-unverified', applicationSha: 'a'.repeat(40), schemaSha: 'b'.repeat(64), toolingSha: 'c'.repeat(64), database: { bytes: dump.length, sha256: sha256(dump) }, objects, ...state }
const archive = path.join(privateRoot, 'unit-source'), output = path.join(privateRoot, 'unit-output')
beforeEach(() => {
  vi.resetAllMocks()
  io.stat.mockResolvedValue({ isSymbolicLink: () => false, isFile: () => true, size: 10 })
  io.read.mockImplementation(async (file: string) => file.endsWith('manifest.json') ? Buffer.from(JSON.stringify(manifest)) : file.endsWith('database.dump') ? dump : body)
  io.command.mockImplementation(async (_executable, args: string[]) => args.includes('rev-parse') ? 'a'.repeat(40) : '')
  io.ownedContainers.mockResolvedValue({ postgres: 'owned-db', localstack: 'owned-s3' })
  io.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('pg_tables') ? [{ tablename: 'users' }, { tablename: 'expense_notes' }] : sql.includes('pg_export_snapshot') ? [{ snapshot: 'snapshot-1' }] : [{ count: 0 }] }))
  io.connect.mockResolvedValue({ query: io.query, release: io.release })
  io.snapshot.mockResolvedValue(state); io.objects.mockResolvedValue(objects.map(o => ({ Key: o.key })))
  io.receipt.mockImplementation(async (_config, _s3, key: string) => ({ body, metadata: objects.find(o => o.key === key) }))
  io.dump.mockResolvedValue(manifest.database)
  let sends = 0
  io.send.mockImplementation(async () => { if (++sends === 1) throw { $metadata: { httpStatusCode: 404 } }; return {} })
  io.verify.mockResolvedValue({ roles: ['employee', 'manager', 'hr_admin'], uniqueReceiptsRead: 2 })
})
afterEach(() => vi.restoreAllMocks())
describe('isolated demo lifecycle', () => {
  it('prepares only a fresh target and publishes its private configuration', async () => {
    const result = await prepareDemo(output, ports)
    expect(result).toMatchObject({ ready: true, database: 'expense_io_test', accounts: 3, runtime: 'expense_web' })
    expect(io.vacant).toHaveBeenCalledTimes(4)
    expect(io.write.mock.calls.some(([file, data]) => file.endsWith('runtime.json') && JSON.parse(data).project === result.project)).toBe(true)
    expect(io.provision).toHaveBeenCalledOnce(); expect(io.end).toHaveBeenCalledOnce()
  })
  it('refuses teardown without explicit disposable confirmation', async () => {
    await expect(downDemo(newDemo(ports), false)).rejects.toThrow('explicit_disposable_confirmation_required')
    expect(io.docker).not.toHaveBeenCalled()
  })
  it('tears down only the validated project and keeps archives', async () => {
    const config = newDemo(ports)
    expect(await downDemo(config, true)).toMatchObject({ status: 'owned-demo-services-removed', project: config.project })
    expect(io.docker).toHaveBeenCalledWith(config, ['compose', 'down', '--volumes', '--remove-orphans'], 90000)
    expect(io.write).not.toHaveBeenCalled()
  })
})
describe('backup capture', () => {
  it('publishes an unverified manifest only after consistent DB and receipt capture', async () => {
    const result = await backup(newDemo(ports), output, true)
    expect(result).toMatchObject({ status: 'exported-unverified', accounts: 3, receipts: 2 })
    const manifests = io.write.mock.calls.filter(([file]) => file.endsWith('manifest.json')).map(([, data]) => JSON.parse(data))
    expect(manifests.map(m => m.status)).toEqual(['incomplete', 'exported-unverified'])
    expect(manifests[1]).toMatchObject({ objects, database: manifest.database, ...state })
    expect(io.release).toHaveBeenCalledOnce(); expect(io.end).toHaveBeenCalledOnce(); expect(io.destroy).toHaveBeenCalledOnce()
  })
  it('refuses capture without stopped-writer confirmation', async () => {
    await expect(backup(newDemo(ports), output, false)).rejects.toThrow('confirm_stopped_synthetic_demo_required')
    expect(io.connect).not.toHaveBeenCalled()
  })
  it.each(['active-clients', 'empty-schema', 'missing-receipt', 'changed-inventory', 'changed-body', 'dirty-source', 'untracked-source'])('leaves capture unverified on %s', async fault => {
    if (fault === 'active-clients') io.query.mockResolvedValue({ rows: [{ count: 1 }] })
    if (fault === 'empty-schema') io.query.mockImplementation(async sql => ({ rows: sql.includes('pg_tables') ? [] : [{ count: 0 }] }))
    if (fault === 'missing-receipt') io.objects.mockResolvedValue([{ Key: objects[0].key }])
    if (fault === 'changed-inventory') io.objects.mockResolvedValueOnce(objects.map(o => ({ Key: o.key }))).mockResolvedValue([])
    if (fault === 'changed-body') { let reads = 0; io.receipt.mockImplementation(async (_c, _s, key) => ({ body, metadata: { ...objects.find(o => o.key === key), sha256: String(++reads) } })) }
    if (fault === 'dirty-source') io.command.mockRejectedValue(new Error('dirty tree'))
    if (fault === 'untracked-source') io.command.mockResolvedValue('untracked.ts')
    await expect(backup(newDemo(ports), output, true)).rejects.toThrow()
    expect(io.write.mock.calls.filter(([file]) => file.endsWith('manifest.json')).map(([, data]) => JSON.parse(data).status)).toEqual(['incomplete'])
    expect(io.release).toHaveBeenCalledOnce(); expect(io.destroy).toHaveBeenCalledOnce()
  })
})
describe('restore verification', () => {
  it('verifies archive hashes before provisioning and emits proof after HTTP checks', async () => {
    const result = await restore(newDemo(ports), archive, output, targetPorts)
    expect(result).toMatchObject({ status: 'restoration-verified', accounts: 3, objects: 2, allObjectHashesMatched: true, allTableCountsAndDigestsMatched: true, runtime: 'expense_web' })
    expect(io.restoreDump).toHaveBeenCalledWith(expect.anything(), 'owned-db', dump)
    const writes = io.write.mock.calls.filter(([file]) => file.endsWith('restore-verification.json'))
    expect(writes).toHaveLength(1); expect(JSON.parse(writes[0][1]).manifestSha).toBe(sha256(Buffer.from(JSON.stringify(manifest))))
    expect(io.verify.mock.invocationCallOrder[0]).toBeLessThan(io.write.mock.invocationCallOrder.at(-1)!)
  })
  it.each(['relative-path', 'revision', 'dump-hash', 'receipt-hash', 'non-file', 'oversized'])('rejects %s before creating a target', async fault => {
    if (fault === 'revision') io.command.mockResolvedValue('d'.repeat(40))
    if (fault === 'dump-hash') io.read.mockImplementation(async file => file.endsWith('manifest.json') ? Buffer.from(JSON.stringify(manifest)) : Buffer.from('corrupt'))
    if (fault === 'receipt-hash') io.read.mockImplementation(async file => file.endsWith('manifest.json') ? Buffer.from(JSON.stringify(manifest)) : file.endsWith('database.dump') ? dump : Buffer.from('corrupt'))
    if (fault === 'non-file') io.stat.mockResolvedValue({ isSymbolicLink: () => false, isFile: () => false, size: 1 })
    if (fault === 'oversized') io.stat.mockResolvedValue({ isSymbolicLink: () => false, isFile: () => true, size: 200 * 1024 * 1024 })
    await expect(restore(newDemo(ports), fault === 'relative-path' ? 'relative' : archive, output, targetPorts)).rejects.toThrow()
    expect(io.docker).not.toHaveBeenCalled()
  })
  it.each(['occupied-db', 'occupied-bucket', 'restored-body', 'restored-db', 'restored-inventory', 'http', 'manifest-changed'])('withholds restoration proof after %s failure', async fault => {
    if (fault === 'occupied-db') io.query.mockResolvedValue({ rows: [{ count: 1 }] })
    if (fault === 'occupied-bucket') io.send.mockResolvedValue({})
    if (fault === 'restored-body') io.receipt.mockResolvedValue({ body, metadata: { ...objects[0], bytes: 99 } })
    if (fault === 'restored-db') io.snapshot.mockResolvedValue({ ...state, tables: {} })
    if (fault === 'restored-inventory') io.objects.mockResolvedValue([])
    if (fault === 'http') io.verify.mockRejectedValue(new Error('HTTP failed'))
    if (fault === 'manifest-changed') { let reads = 0; io.read.mockImplementation(async file => file.endsWith('manifest.json') ? Buffer.from(JSON.stringify({ ...manifest, ...(reads++ ? { changed: true } : {}) })) : file.endsWith('database.dump') ? dump : body) }
    await expect(restore(newDemo(ports), archive, output, targetPorts)).rejects.toThrow()
    expect(io.write.mock.calls.some(([file]) => file.endsWith('restore-verification.json'))).toBe(false)
    expect(io.destroy).toHaveBeenCalledOnce()
  })
})
