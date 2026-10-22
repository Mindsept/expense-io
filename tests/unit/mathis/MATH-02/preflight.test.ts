import { beforeEach, expect, test, vi } from 'vitest'
import { preflight } from '../../../support/preflight.mjs'

const effects = vi.hoisted(() => ({
  loadMigration: vi.fn(), migrate: vi.fn(), storage: vi.fn(), send: vi.fn(), destroy: vi.fn(), seed: vi.fn(),
  pool: vi.fn(), adminQuery: vi.fn(), rlsQuery: vi.fn(), closePool: vi.fn(),
}))
vi.mock('pg', () => ({
  Pool: class {
    query: typeof effects.adminQuery
    constructor(options: { connectionString: string }) {
      effects.pool(options)
      this.query = new URL(options.connectionString).pathname === '/expense_rls_test' ? effects.rlsQuery : effects.adminQuery
    }
    end = effects.closePool
  },
}))
vi.mock('node-pg-migrate', () => {
  effects.loadMigration()
  return { runner: effects.migrate }
})
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    constructor(options: unknown) { effects.storage(options) }
    send = effects.send
    destroy = effects.destroy
  },
  HeadBucketCommand: class { constructor(public input: unknown) {} },
  CreateBucketCommand: class { constructor(public input: unknown) {} },
}))
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFile: effects.seed,
}))
import { prepare } from '../../../support/prepare.mjs'

function settings(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ARLA_TEST_ENV: 'isolated', ARLA_TEST_PROJECT: 'arla-ci-a1b2-c3',
    ARLA_TEST_BASE_URL: 'http://127.0.0.1:3199', ARLA_TEST_DB_PORT: '55440', ARLA_TEST_S3_PORT: '45740', HA01_TEST_PORT: '3198',
    DATABASE_URL: 'postgres://expense_test:synthetic-db-password-123@127.0.0.1:55440/expense_io_test',
    POSTGRES_USER: 'expense_test', POSTGRES_DB: 'expense_io_test', POSTGRES_PASSWORD: 'synthetic-db-password-123',
    S3_ENDPOINT: 'http://127.0.0.1:45740', S3_BUCKET: 'receipts-ci-test',
    S3_REGION: 'us-east-1', S3_FORCE_PATH_STYLE: 'true', S3_ACCESS_KEY_ID: 'test', S3_SECRET_ACCESS_KEY: 'test',
  }
  for (const role of ['HR', 'MANAGER', 'EMPLOYEE']) {
    env[`ARLA_TEST_${role}_EMAIL`] = env[`SEED_${role}_EMAIL`] = `${role.toLowerCase()}@expense.test`
    env[`ARLA_TEST_${role}_PASSWORD`] = env[`SEED_${role}_PASSWORD`] = `synthetic-${role}-password-123`
  }
  return env
}

beforeEach(() => {
  vi.clearAllMocks()
  effects.migrate.mockReset()
  effects.send.mockReset()
  effects.seed.mockReset()
  effects.adminQuery.mockReset()
  effects.rlsQuery.mockReset()
})

test('accepts the declared disposable stack and returns only safe metadata', () => {
  const env = settings()
  const result = preflight(env)
  expect(result).toMatchObject({
    project: 'arla-ci-a1b2-c3', baseUrl: 'http://127.0.0.1:3199', appPort: 3199, authPort: 3198,
    databaseHost: '127.0.0.1', databasePort: 55440, databaseName: 'expense_io_test', databaseUser: 'expense_test',
    storageEndpoint: 'http://127.0.0.1:45740', storagePort: 45740, bucket: 'receipts-ci-test',
    baseline: 'privileged-bootstrap-no-rls-proof',
  })
  const printed = JSON.stringify(result)
  for (const value of [env.DATABASE_URL, env.POSTGRES_PASSWORD, env.ARLA_TEST_HR_PASSWORD, env.ARLA_TEST_HR_EMAIL]) {
    expect(printed).not.toContain(value)
  }
  expect(Object.isFrozen(result)).toBe(true)
})

test.each([
  ['ARLA_TEST_ENV', undefined], ['ARLA_TEST_ENV', 'development'],
  ['ARLA_TEST_PROJECT', 'expense-io'], ['ARLA_TEST_PROJECT', 'arla-ci-'], ['ARLA_TEST_PROJECT', 'arla-ci-../dev'],
  ['ARLA_TEST_BASE_URL', 'http://127.0.0.1:3000'], ['ARLA_TEST_BASE_URL', 'https://remote.example:3199'],
  ['ARLA_TEST_BASE_URL', 'http://user:private-password@127.0.0.1:3199'],
  ['ARLA_TEST_BASE_URL', 'http://127.0.0.1:3199/path'], ['ARLA_TEST_BASE_URL', 'http://127.0.0.1:3199/?token=private'],
  ['ARLA_TEST_BASE_URL', 'http://127.0.0.1:3199/#private'], ['ARLA_TEST_BASE_URL', 'not-a-url'],
  ['ARLA_TEST_DB_PORT', '5433'], ['ARLA_TEST_DB_PORT', '65536'], ['ARLA_TEST_S3_PORT', '45740junk'],
  ['HA01_TEST_PORT', '3199'], ['ARLA_TEST_DB_PORT', '3199'], ['ARLA_TEST_S3_PORT', '55440'],
  ['DATABASE_URL', 'postgres://expense_test:private-password@remote.example:55440/expense_io_test'],
  ['DATABASE_URL', 'postgres://expense_test:private-password@127.0.0.1:55441/expense_io_test'],
  ['DATABASE_URL', 'postgres://expense_test:private-password@127.0.0.1:55440/expense_io'],
  ['DATABASE_URL', 'postgres://other:private-password@127.0.0.1:55440/expense_io_test'],
  ['DATABASE_URL', 'postgres://expense_test:private-password@127.0.0.1:55440/expense_io_test?host=remote.example'],
  ['DATABASE_URL', 'postgres://expense_test:private-password@127.0.0.1:55440/expense_io_test#private'],
  ['DATABASE_URL', 'postgres://expense_test:private-password@127.0.0.1:55440/expense_io_test'],
  ['POSTGRES_DB', 'expense_io'], ['POSTGRES_USER', 'expense'], ['POSTGRES_PASSWORD', 'private-other-password'],
  ['S3_ENDPOINT', 'https://s3.amazonaws.com'], ['S3_ENDPOINT', 'http://127.0.0.1:45741'],
  ['S3_ENDPOINT', 'http://user:private-password@127.0.0.1:45740'], ['S3_BUCKET', 'receipts'],
  ['S3_ACCESS_KEY_ID', 'private-real-key'], ['S3_SECRET_ACCESS_KEY', 'private-real-key'],
  ['S3_REGION', 'eu-west-1'], ['S3_FORCE_PATH_STYLE', 'false'],
  ['ARLA_TEST_HR_EMAIL', 'hr@example.com'], ['SEED_EMPLOYEE_EMAIL', 'demo@expense.test'],
  ['SEED_MANAGER_PASSWORD', 'private-mismatch'], ['ARLA_TEST_EMPLOYEE_PASSWORD', 'short'],
] as const)('refuses unsafe or mismatched %s without publishing its value', (field, value) => {
  const env = { ...settings(), [field]: value }
  expect(() => preflight(env)).toThrow('Unsafe test configuration')
  try { preflight(env) }
  catch (error) {
    const diagnostic = String(error)
    for (const secret of ['private-password', 'private-real-key', 'private-mismatch', 'synthetic-db-password-123']) {
      expect(diagnostic).not.toContain(secret)
    }
  }
})

test('compares the decoded password instead of the encoded URL representation', () => {
  const env = settings()
  env.POSTGRES_PASSWORD = 'synthetic-password:@/123'
  env.DATABASE_URL = `postgres://expense_test:${encodeURIComponent(env.POSTGRES_PASSWORD)}@127.0.0.1:55440/expense_io_test`
  expect(preflight(env).databaseName).toBe('expense_io_test')
})

test.each([
  '', 'postgres://expense_test:synthetic-db-password-123@127.0.0.1:55440/expense_io_test',
  'postgres://expense_test:synthetic-db-password-123@127.0.0.1:55440/other_test',
  'postgres://expense_test:synthetic-db-password-123@remote.example:55440/expense_rls_test',
  'postgres://expense_test:synthetic-db-password-123@127.0.0.1:55441/expense_rls_test',
  'postgres://other:synthetic-db-password-123@127.0.0.1:55440/expense_rls_test',
  'postgres://expense_test:private-password-mismatch@127.0.0.1:55440/expense_rls_test',
  'postgres://expense_test:synthetic-db-password-123@127.0.0.1:55440/expense_rls_test?host=remote.example',
  'postgres://expense_test:synthetic-db-password-123@127.0.0.1:55440/expense_rls_test#private',
])('rejects a mismatched HA-04 database before opening either database', async url => {
  const env = { ...settings(), HA04_TEST_ADMIN_DATABASE_URL: url }
  await expect(prepare(env)).rejects.toThrow('HA04_TEST_ADMIN_DATABASE_URL')
  expect(effects.pool).not.toHaveBeenCalled()
  expect(effects.migrate).not.toHaveBeenCalled()
  expect(effects.storage).not.toHaveBeenCalled()
  expect(effects.seed).not.toHaveBeenCalled()
})

test.each([false, true])('keeps HA-04 empty and separate from the migrated baseline (already exists: %s)', async existing => {
  effects.adminQuery.mockResolvedValue({ rows: existing ? [{ datname: 'expense_rls_test' }] : [] })
  effects.rlsQuery.mockResolvedValue({ rows: [{ occupied: false }] })
  effects.migrate.mockResolvedValue([])
  effects.send.mockResolvedValue({})
  effects.seed.mockImplementation((_file: string, _args: string[], _options: unknown, callback: (error: Error | null) => void) => callback(null))
  const output = vi.spyOn(console, 'info').mockImplementation(() => {})
  try {
    const env: Record<string, string | undefined> = {
      ...settings(), HA04_TEST_ADMIN_DATABASE_URL: 'postgres://expense_test:synthetic-db-password-123@127.0.0.1:55440/expense_rls_test',
    }
    expect((await prepare(env)).rlsDatabaseName).toBe('expense_rls_test')
    expect(effects.pool.mock.calls.map(([options]) => new URL(options.connectionString).pathname)).toEqual(['/expense_io_test', '/expense_rls_test'])
    expect(effects.adminQuery).toHaveBeenCalledWith('SELECT datname FROM pg_database WHERE datname = $1', ['expense_rls_test'])
    expect(effects.adminQuery).toHaveBeenCalledTimes(existing ? 1 : 2)
    if (!existing) expect(effects.adminQuery).toHaveBeenCalledWith('CREATE DATABASE expense_rls_test')
    for (const [sql] of [...effects.adminQuery.mock.calls, ...effects.rlsQuery.mock.calls]) {
      expect(sql).not.toMatch(/\b(BEGIN|DROP|TRUNCATE|ALTER|INSERT|CREATE TABLE)\b/i)
    }
    expect(effects.rlsQuery).toHaveBeenCalledTimes(1)
    expect(effects.migrate.mock.calls[0][0].databaseUrl.connectionString).toBe(env.DATABASE_URL)
    expect(effects.seed.mock.calls[0][2].env.DATABASE_URL).toBe(env.DATABASE_URL)
    expect(effects.closePool).toHaveBeenCalledTimes(2)
  } finally { output.mockRestore() }
})

test('refuses an existing nonempty HA-04 database without dropping data or migrating either database', async () => {
  effects.adminQuery.mockResolvedValue({ rows: [{ datname: 'expense_rls_test' }] })
  effects.rlsQuery.mockResolvedValue({ rows: [{ occupied: true }] })
  const env = { ...settings(), HA04_TEST_ADMIN_DATABASE_URL: 'postgres://expense_test:synthetic-db-password-123@127.0.0.1:55440/expense_rls_test' }
  await expect(prepare(env)).rejects.toThrow('empty RLS test database preparation')
  expect(effects.adminQuery).toHaveBeenCalledTimes(1)
  expect(effects.rlsQuery).toHaveBeenCalledTimes(1)
  expect(effects.migrate).not.toHaveBeenCalled()
  expect(effects.seed).not.toHaveBeenCalled()
  expect(effects.closePool).toHaveBeenCalledTimes(2)
})

test('rejects the target before loading migration code or performing any mutation', async () => {
  await expect(prepare({ ...settings(), ARLA_TEST_ENV: 'development' })).rejects.toThrow('ARLA_TEST_ENV')
  expect(effects.loadMigration).not.toHaveBeenCalled()
  expect(effects.migrate).not.toHaveBeenCalled()
  expect(effects.storage).not.toHaveBeenCalled()
  expect(effects.seed).not.toHaveBeenCalled()
})

test('fails closed on a migration error without exposing driver credentials or starting the seed', async () => {
  effects.migrate.mockRejectedValue(new Error('postgres://user:private-password@host/db'))
  let diagnostic = ''
  try { await prepare(settings()) }
  catch (error) { diagnostic = String(error) }
  expect(diagnostic).toContain('database migrations')
  expect(diagnostic).not.toContain('private-password')
  expect(diagnostic).not.toContain('postgres://')
  expect(effects.storage).not.toHaveBeenCalled()
  expect(effects.seed).not.toHaveBeenCalled()
})

test.each([false, true])('prepares the baseline while containing seed output (bucket missing: %s)', async missing => {
  effects.migrate.mockResolvedValue([])
  effects.send.mockResolvedValue({})
  if (missing) effects.send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } })
  effects.seed.mockImplementation((_file: string, _args: string[], _options: unknown,
    callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    callback(null, 'Credentials: private-seed-output', 'private-child-diagnostic')
  })
  const output = vi.spyOn(console, 'info').mockImplementation(() => {})
  try {
    const env: Record<string, string | undefined> = { ...settings(), NODE_OPTIONS: '--require private-preloader', DOTENV_CONFIG_PATH: 'private.env' }
    const metadata = await prepare(env)
    expect(metadata.baseline).toBe('privileged-bootstrap-no-rls-proof')
    expect(effects.send).toHaveBeenCalledTimes(missing ? 2 : 1)
    expect(effects.destroy).toHaveBeenCalledOnce()
    expect(effects.seed).toHaveBeenCalledOnce()
    const options = effects.seed.mock.calls[0][2]
    expect(options.windowsHide).toBe(true)
    expect(options.cwd).toContain('arla-ci-seed-')
    expect(options.cwd).not.toBe(process.cwd())
    expect(options.env.NODE_OPTIONS).toBeUndefined()
    expect(options.env.DOTENV_CONFIG_PATH).toBeUndefined()
    expect(options.env.DATABASE_URL).toBe(env.DATABASE_URL)
    expect(options.env.SEED_HR_PASSWORD).toBe(env.ARLA_TEST_HR_PASSWORD)
    expect(JSON.stringify(output.mock.calls)).not.toContain('private-')
    expect(JSON.stringify(output.mock.calls)).not.toContain(env.POSTGRES_PASSWORD)
  } finally { output.mockRestore() }
})
