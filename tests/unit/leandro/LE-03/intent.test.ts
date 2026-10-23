import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { submissionFingerprint, submissionIntentKey } from '@/lib/submission-intent'
import { reconciliationOptions } from '@/lib/submission-reconciliation.mjs'
import type { ExpenseSubmissionInput } from '@/ports/ExpenseSubmissionPort'

const key = '11111111-AAAA-4111-8111-111111111111'
const input: ExpenseSubmissionInput = { amount: '12.30', expenseDate: '2024-02-29', description: 'Synthetic taxi', buffer: Buffer.from('synthetic bytes'), mimeType: 'image/png', extension: '.png' }
it('accepts a canonical UUID intent and leaves the legacy header optional', () => {
  expect(submissionIntentKey(new Headers())).toBeUndefined()
  expect(submissionIntentKey(new Headers({ 'Idempotency-Key': key }))).toBe(key.toLowerCase())
})
it.each(['', 'constructor', 'not-a-uuid', `${key},${key}`, '11111111-aaaa-0111-0111-111111111111'])('refuses malformed or repeated key %s', value => {
  expect(() => submissionIntentKey(new Headers({ 'Idempotency-Key': value }))).toThrow()
})
it('canonicalizes equivalent accepted decimals while hashing exact receipt bytes and business fields', () => {
  const fingerprint = submissionFingerprint(input)
  expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
  expect(submissionFingerprint({ ...input, amount: '00012.3' })).toBe(fingerprint)
  for (const change of [{ amount: '12.31' }, { expenseDate: '2024-03-01' }, { description: 'Other' }, { buffer: Buffer.from('changed') }, { mimeType: 'image/jpeg' }]) {
    expect(submissionFingerprint({ ...input, ...change })).not.toBe(fingerprint)
  }
})
it('bounds reconciliation options before any service access', () => {
  expect(reconciliationOptions({ companyId: key })).toEqual({ companyId: key.toLowerCase(), limit: 25, minAgeMs: 300000, maxDurationMs: 30000 })
  for (const change of [{ companyId: 'private-invalid' }, { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { minAgeMs: 299999 }, { maxDurationMs: 999 }, { maxDurationMs: 120001 }]) expect(() => reconciliationOptions({ companyId: key, ...change })).toThrow('Invalid reconciliation options')
})
it.each([['--unknown-secret', 'private'], ['--company-id', key], ['--company-id', key, '--apply', '--dry-run']].map(args => ({ args })))('private CLI refuses invalid/missing settings without echo or application DB fallback: $args', ({ args }) => {
  const result = spawnSync(process.execPath, ['scripts/leandro/LE-03/reconcile.mjs', ...args], {
    env: { ...process.env, LE03_MAINTENANCE_DATABASE_URL: '', DATABASE_URL: 'postgres://private-secret@unreachable.invalid/production' }, encoding: 'utf8', timeout: 5000,
  })
  expect(result.status).toBe(2)
  expect(result.stdout).toBe('')
  expect(result.stderr.trim()).toBe(JSON.stringify({ operation: 'expense.submit.reconcile', code: 'configuration_or_database_failure' }))
  expect(result.stderr).not.toMatch(/private|production|unreachable/)
})
