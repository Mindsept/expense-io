import { expect, test } from 'vitest'
import { benchmarkWebEnvironment } from '../../../../scripts/mathis/MATH-05/runtime.mjs'

const target = {
  databaseURL: 'postgres://expense_test:admin-secret@127.0.0.1:55440/expense_io_test',
  runtimeDatabaseURL: `postgres://expense_web:${'w'.repeat(64)}@127.0.0.1:55440/expense_io_test`,
  env: { AUTH_SECRET: 'auth-only', S3_BUCKET: 'receipts-ci-test', POSTGRES_PASSWORD: 'admin-secret',
    HA04_ADMIN_DATABASE_URL: 'private-admin', SEED_EMPLOYEE_PASSWORD: 'fixture-secret' },
}

test('the actual web child receives only runtime and allowlisted configuration', () => {
  const env = benchmarkWebEnvironment(target, { PATH: '/bin', HA04_ADMIN_DATABASE_URL: 'inherited-admin',
    DATABASE_URL: target.databaseURL, LE03_MAINTENANCE_DATABASE_URL: 'maintenance', NODE_OPTIONS: '--import=unexpected' })
  expect(env).toEqual({ DATABASE_URL: new URL(target.runtimeDatabaseURL).href, NODE_ENV: 'production',
    AWS_EC2_METADATA_DISABLED: 'true', PATH: '/bin', AUTH_SECRET: 'auth-only', S3_BUCKET: 'receipts-ci-test' })
  expect(JSON.stringify(env)).not.toMatch(/admin-secret|private-admin|inherited-admin|maintenance|fixture-secret|unexpected/)
})

test.each([
  undefined,
  target.databaseURL,
  target.runtimeDatabaseURL.replace('127.0.0.1', 'db.example.test'),
  target.runtimeDatabaseURL.replace(':55440/', ':5433/'),
  target.runtimeDatabaseURL.replace('expense_io_test', 'expense_io'),
  target.runtimeDatabaseURL + '?options=-crole=expense_test',
])('refuses unsafe runtime targets instead of falling back to the administrator', runtimeDatabaseURL => {
  expect(() => benchmarkWebEnvironment({ ...target, runtimeDatabaseURL }, {})).toThrow()
})
