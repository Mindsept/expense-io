import { expect, test } from 'vitest'
import { readTestIdentity, readTestTarget } from '../../../support/test-target'

test('requires an explicit test marker and URL without consulting a development default', () => {
  expect(() => readTestTarget({})).toThrow('ARLA_TEST_ENV')
  expect(() => readTestTarget({ ARLA_TEST_BASE_URL: 'http://127.0.0.1:3199' })).toThrow('ARLA_TEST_ENV')
  expect(() => readTestTarget({ ARLA_TEST_ENV: 'isolated' })).toThrow('ARLA_TEST_BASE_URL')
})

test.each(['https://example.com', 'http://127.0.0.1:3000', 'http://localhost',
  'http://localhost:80', 'http://user:password@localhost:3199', 'http://localhost:3199/path',
  'http://localhost:3199/?token=private', 'http://localhost:3199/#secret', 'invalid'])('refuses an unsafe or ambiguous target without disclosing it', (url) => {
  expect(() => readTestTarget({ ARLA_TEST_ENV: 'isolated', ARLA_TEST_BASE_URL: url })).toThrow('ARLA_TEST_BASE_URL')
  try { readTestTarget({ ARLA_TEST_ENV: 'isolated', ARLA_TEST_BASE_URL: url }) }
  catch (error) { expect(String(error)).not.toContain(url) }
})

test('accepts explicitly designated loopback test targets', () => {
  expect(readTestTarget({ ARLA_TEST_ENV: 'isolated', ARLA_TEST_BASE_URL: 'http://127.0.0.1:3199/' })).toBe('http://127.0.0.1:3199')
})

test('requires role-specific credentials and keeps them out of configuration errors', () => {
  expect(() => readTestIdentity('HR', {})).toThrow('ARLA_TEST_HR_EMAIL')
  expect(() => readTestIdentity('HR', { ARLA_TEST_HR_EMAIL: 'invalid', ARLA_TEST_HR_PASSWORD: 'private' })).toThrow('ARLA_TEST_HR_PASSWORD')
  expect(readTestIdentity('HR', { ARLA_TEST_HR_EMAIL: 'hr@example.test', ARLA_TEST_HR_PASSWORD: 'synthetic' })).toEqual({ email: 'hr@example.test', password: 'synthetic' })
})
