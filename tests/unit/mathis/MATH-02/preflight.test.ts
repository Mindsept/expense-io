import { expect, test } from 'vitest'
import { assertLocalDockerEndpoint, createTestConfig, redactTestOutput, summarizeTarget, testEnvironment, validateTestConfig } from '../../../support/preflight.mjs'

test('creates a coherent isolated target without reusing development names or ports', () => {
  const config = createTestConfig()
  expect(validateTestConfig(config)).toBe(config)
  expect(config.database).toMatch(/^expense_[a-f0-9]{8}_test$/)
  expect(config.bucket).toMatch(/^receipts-[a-f0-9]{8}-test$/)
  expect(new Set([config.appPort,config.dbPort,config.s3Port,config.authPort]).size).toBe(4)
  expect(createTestConfig().id).not.toBe(config.id)
  const env = testEnvironment(config)
  expect(env.HA07_TEST_DATABASE_URL).toBe(env.DATABASE_URL)
  expect(env.LE12_TEST_BASE_URL).toBe(env.ARLA_TEST_BASE_URL)
  expect(env.SEED_EMPLOYEE_EMAIL).toBe(config.accounts.EMPLOYEE.email)
  expect(env.ARLA_TEST_EMPLOYEE_PASSWORD).toBe(env.SEED_EMPLOYEE_PASSWORD)
})

test.each([
  { mode: 'development' }, { id: '../main' }, { project: 'expense-io' },
  { database: 'expense_io' }, { bucket: 'receipts' }, { dbPort: 5433 },
  { appPort: 3000 }, { s3Port: 4567 }, { appPort: 3211 }, { appPort: 70000 },
  { databaseURL: 'postgres://secret:private@localhost:5433/expense_io' },
  { baseURL: 'https://example.com' }, { baseURL: 'http://127.0.0.1:3210/path' },
  { s3URL: 'http://example.com:45740' }, { authSecret: 'changeme' },
])('refuses an unsafe target before any preparation or cleanup: %j', (change) => {
  const config = { ...createTestConfig(), ...change }
  expect(() => validateTestConfig(config)).toThrow('No preparation or cleanup was started')
  expect(() => testEnvironment(config)).toThrow('Unsafe test target')
})

test('rejects mismatched identities and secrets without exposing their values', () => {
  const config = createTestConfig()
  config.accounts.HR.email = 'real-person@example.com'
  expect(() => validateTestConfig(config)).toThrow('Unsafe test target')
})

test.each(['tcp://127.0.0.1:2375','tcp://remote:2376','ssh://remote','',undefined])('refuses remote or unspecified Docker endpoints: %s', endpoint => {
  expect(() => assertLocalDockerEndpoint(endpoint)).toThrow('remote Docker endpoint')
})

test('accepts local sockets without treating TCP loopback as a local Docker engine', () => {
  expect(() => assertLocalDockerEndpoint('unix:///var/run/docker.sock')).not.toThrow()
  expect(() => assertLocalDockerEndpoint('npipe:////./pipe/docker_engine')).not.toThrow()
})

test('redacts full credentials, password fragments, signed URLs and response cookies', () => {
  const config = createTestConfig()
  const original = [config.databaseURL,new URL(config.databaseURL).password,config.authSecret,
    config.fixturePassword,...Object.values(config.accounts).map(account=>account.password),
    'http://127.0.0.1:45740/receipts/key?X-Amz-Signature=private', 'set-cookie: authjs.session-token=private'].join('\n')
  const safe = redactTestOutput(original,config)
  for (const value of [config.authSecret,config.fixturePassword,...Object.values(config.accounts).map(account=>account.password)]) expect(safe).not.toContain(value)
  expect(safe).not.toContain('private')
  expect(safe).not.toContain(new URL(config.databaseURL).password)
  expect(summarizeTarget(config)).not.toHaveProperty('databaseURL')
  expect(summarizeTarget(config).isolation).toContain('HA-04')
})
