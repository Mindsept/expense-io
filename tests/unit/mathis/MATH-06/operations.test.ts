import { expect, test, vi } from 'vitest'
import { HeadBucketCommand, ListBucketsCommand } from '@aws-sdk/client-s3'
import { doctor } from '../../../../scripts/mathis/MATH-06/doctor.mjs'
import { checkedDemo, newDemo, newTarget, validateManifest, sha256, safeError, OperationsError } from '../../../../scripts/mathis/MATH-06/guards.mjs'
import { webEnvironment } from '../../../../scripts/mathis/MATH-06/verify-http.mjs'
import { receipt } from '../../../../scripts/mathis/MATH-06/services.mjs'
import { Readable } from 'node:stream'

const ports = { app: 3215, auth: 3216, db: 55440, s3: 45740 }
const identity = { role: 'expense_web', login: 'expense_web', rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolinherit: false }
function services(options: { databaseDown?: boolean; storageDown?: boolean; bucketMissing?: boolean; forbidden?: boolean; privileged?: boolean } = {}) {
  const query = vi.fn(async (sql: string) => {
    if (options.databaseDown) throw Error('postgres://secret:private@127.0.0.1')
    return { rows: sql.startsWith('SELECT') ? [{ ...identity, rolsuper: !!options.privileged }] : [] }
  })
  const release = vi.fn()
  const pool = { connect: vi.fn(async () => ({ query, release })) }
  const send = vi.fn(async (command: unknown, optionsArg: { abortSignal: AbortSignal }) => {
    expect(optionsArg.abortSignal).toBeInstanceOf(AbortSignal)
    if (options.storageDown) throw Error('S3_PRIVATE_SECRET')
    if (command instanceof HeadBucketCommand && options.bucketMissing) throw { $metadata: { httpStatusCode: 404 } }
    if (command instanceof HeadBucketCommand && options.forbidden) throw { $metadata: { httpStatusCode: 403 } }
    return {}
  })
  return { pool, s3: { send }, query, release, send }
}

test('doctor refuses missing configuration before connecting to a service', async () => {
  const dependencies = services(), report = await doctor({}, dependencies)
  expect(report.ok).toBe(false)
  expect(report.components.configuration.state).toBe('missing')
  expect(dependencies.pool.connect).not.toHaveBeenCalled()
  expect(dependencies.send).not.toHaveBeenCalled()
})
test('doctor uses only a read-only SQL transaction and S3 read commands when all services respond', async () => {
  const dependencies = services(), report = await doctor(newDemo(ports), dependencies)
  expect(report.ok).toBe(true)
  expect(dependencies.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN READ ONLY', expect.stringMatching(/^SELECT current_user/), 'ROLLBACK'])
  expect(dependencies.release).toHaveBeenCalledOnce()
  expect(dependencies.send.mock.calls[0][0]).toBeInstanceOf(ListBucketsCommand)
  expect(dependencies.send.mock.calls[1][0]).toBeInstanceOf(HeadBucketCommand)
})
test.each([
  [{ databaseDown: true }, 'database', 'unavailable'],
  [{ storageDown: true }, 'storage', 'unavailable'],
  [{ bucketMissing: true }, 'bucket', 'missing'],
  [{ forbidden: true }, 'bucket', 'unavailable'],
  [{ privileged: true }, 'database', 'unsafe'],
] as const)('doctor reports each unavailable or unsafe component without secrets: %j', async (fault, component, state) => {
  const dependencies = services(fault), report = await doctor(newDemo(ports), dependencies)
  expect(report.ok).toBe(false)
  expect(report.components[component].state).toBe(state)
  expect(JSON.stringify(report)).not.toMatch(/private@|S3_PRIVATE_SECRET/)
  expect(dependencies.send.mock.calls.every(([command]) => command instanceof ListBucketsCommand || command instanceof HeadBucketCommand)).toBe(true)
})
test.each([
  { DATABASE_URL: 'postgres://expense:private@127.0.0.1:5433/expense_io' },
  { S3_BUCKET: 'receipts' },
  { S3_ENDPOINT: 'http://192.168.1.1:45740' },
  { ARLA_TEST_PROJECT: 'development' },
  { ARLA_TEST_ENV: 'development' },
])('backup/restore target guard refuses development/foreign configuration before services: %j', change => {
  const config = newDemo(ports)
  expect(() => checkedDemo({ ...config, env: { ...config.env, ...change } })).toThrow()
})
test('new restore target keeps source credentials private and untouched while replacing all service identities', () => {
  const source = newDemo(ports), before = JSON.stringify(source)
  const target = newTarget(source, { app: 3225, auth: 3226, db: 55441, s3: 45741 })
  expect(JSON.stringify(source)).toBe(before)
  expect(target.project).not.toBe(source.project)
  expect(target.env.DATABASE_URL).not.toBe(source.env.DATABASE_URL)
  expect(target.webURL).not.toBe(source.webURL)
  expect(target.env.AUTH_SECRET).not.toBe(source.env.AUTH_SECRET)
  expect(target.env.ARLA_TEST_EMPLOYEE_PASSWORD).toBe(source.env.ARLA_TEST_EMPLOYEE_PASSWORD)
  expect(checkedDemo(target).databaseName).toBe('expense_io_test')
  expect(() => newTarget(source, ports)).toThrow('new_ports_required')
})
test('restricted HTTP verification never receives the maintenance URL or seed passwords', () => {
  const config = newDemo(ports), env = webEnvironment(config)
  expect(env.DATABASE_URL).toBe(config.webURL)
  expect(JSON.stringify(env)).not.toContain(config.env.POSTGRES_PASSWORD)
  expect(Object.keys(env).some(key => /SEED_|PASSWORD|ADMIN/.test(key))).toBe(false)
  expect(env).not.toHaveProperty('NODE_TLS_REJECT_UNAUTHORIZED')
})
function manifest() {
  const objects = [1, 2].map(index => ({ key: `receipts/${index}.png`, bytes: 3, sha256: sha256('png'), contentType: 'image/png' }))
  return { format: 'arla-math06-v1', status: 'exported-unverified', applicationSha: 'a'.repeat(40), schemaSha: 'b'.repeat(64), database: { bytes: 100, sha256: 'c'.repeat(64) }, accounts: 3, tables: { users: { count: 3 }, expense_notes: { count: 2 } }, objects, receiptReferences: objects.map(object => object.key) }
}
test('an export remains unverified until the separate restoration proof exists', () => {
  expect(validateManifest(manifest()).status).toBe('exported-unverified')
  expect(() => validateManifest({ ...manifest(), status: 'incomplete' })).toThrow('incomplete_or_invalid_manifest')
  expect(() => validateManifest({ ...manifest(), receiptReferences: ['receipts/missing.png', 'receipts/2.png'] })).toThrow('missing_receipt_in_manifest')
})
test.each(['../../.env', 'receipts/../../.env', 'https://example.test/private', 'receipts\\secret.png'])('manifest rejects a receipt path that could escape local output: %s', key => {
  const changed = manifest(); changed.objects[0].key = key
  expect(() => validateManifest(changed)).toThrow('invalid_receipt_manifest')
})
test('manifest rejects duplicate objects, malformed checksums and excessive object size', () => {
  const original = manifest()
  expect(() => validateManifest({ ...original, objects: [original.objects[0], original.objects[0]] })).toThrow('invalid_receipt_manifest')
  for (const change of [{ sha256: 'untrusted' }, { bytes: 11 * 1024 * 1024 }, { contentType: 'text/html' }]) {
    const changed = manifest(); Object.assign(changed.objects[0], change)
    expect(() => validateManifest(changed)).toThrow('invalid_receipt_manifest')
  }
})
test('backup accepts and preserves WebP receipts supported by LE-01', async () => {
  const changed = manifest(); changed.objects[0] = { ...changed.objects[0], key: 'receipts/1.webp', contentType: 'image/webp' }; changed.receiptReferences[0] = 'receipts/1.webp'
  expect(validateManifest(changed)).toBe(changed)
  const body = Buffer.from('synthetic-webp-bytes')
  const copied = await receipt(newDemo(ports), { send: async () => ({ ContentType: 'image/webp', ContentLength: body.length, Body: Readable.from([body]) }) }, 'receipts/1.webp')
  expect(copied.body).toEqual(body)
  expect(copied.metadata).toMatchObject({ contentType: 'image/webp', sha256: sha256(body) })
})
test('manifest refuses an excessive cumulative archive even when every object is individually allowed', () => {
  const original = manifest(), objects = Array.from({ length: 13 }, (_, index) => ({ ...original.objects[0], key: `receipts/${index}.png`, bytes: 10 * 1024 * 1024 }))
  expect(() => validateManifest({ ...original, objects })).toThrow('demo_archive_size_limit')
})
test('CLI diagnostics never publish arbitrary driver errors', () => {
  expect(safeError(new Error('postgres://administrator:SECRET@localhost/db'))).not.toContain('SECRET')
  expect(safeError(new OperationsError('MATH-06: existing_target_refused.'))).toContain('existing_target_refused')
})
