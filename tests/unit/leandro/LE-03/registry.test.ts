import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/errors'

const mocks = vi.hoisted(() => ({ scope: vi.fn(), query: vi.fn(), row: {} as Record<string, unknown> }))
vi.mock('@/lib/current-actor', () => ({ withCurrentActor: mocks.scope }))
import { PostgresSubmissionRegistry, assertClaimScope } from '@/adapters/PostgresSubmissionRegistry'
const actor = { id: '11111111-1111-4111-8111-111111111111', companyId: '22222222-2222-4222-8222-222222222222', role: 'employee' as const }
const opId = '33333333-3333-4333-8333-333333333333'
const noteId = '44444444-4444-4444-8444-444444444444'
const key = '55555555-5555-4555-8555-555555555555'
const fingerprint = 'a'.repeat(64)
const registry = new PostgresSubmissionRegistry()
const dto = { id: noteId, userId: actor.id, amount: 12.3, expenseDate: '2024-02-29', description: 'Synthetic', receiptKey: 'receipts/synthetic.png', status: 'pending', createdAt: '2026-10-23T10:00:00.000Z' }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.row = { id: opId, fingerprint, state: 'failed', current_attempt_id: null, note_id: null, result: null, expired: false, lease_active: false }
  mocks.scope.mockImplementation(async (_role, operation) => operation({ query: mocks.query }, actor))
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT *, expires_at')) return { rows: [mocks.row] }
    if (sql.includes('SELECT id FROM expense_notes')) return { rows: [{ id: noteId }] }
    if (sql.includes('SELECT state,current_attempt_id')) return { rows: [mocks.row] }
    return { rows: [{ id: opId }] }
  })
})
it('atomically reserves an owned company operation and a new opaque attempt', async () => {
  const result = await registry.reserve(key, fingerprint, '.png')
  expect(result.kind).toBe('attempt')
  if (result.kind !== 'attempt') throw new Error('Expected attempt')
  expect(result.claim).toMatchObject({ operationId: opId, userId: actor.id, companyId: actor.companyId })
  expect(result.claim.receiptKey).toBe(`receipts/${result.claim.attemptId}.png`)
  expect(Object.isFrozen(result.claim)).toBe(true)
  expect(mocks.scope).toHaveBeenCalledOnce()
  expect(mocks.query).toHaveBeenNthCalledWith(1, expect.stringContaining('ON CONFLICT'), [actor.id, actor.companyId, key, fingerprint])
  expect(mocks.query).toHaveBeenNthCalledWith(2, expect.stringContaining('FOR UPDATE'), [actor.id, actor.companyId, key])
})
it.each([['different content', { fingerprint: 'b'.repeat(64) }, 'idempotency_conflict'], ['expired', { expired: true }, 'idempotency_expired'], ['active', { state: 'processing', lease_active: true }, 'idempotency_in_progress']])('refuses %s without creating an attempt or changing the first result', async (_label, change, code) => {
  Object.assign(mocks.row, change)
  const error = await registry.reserve(key, fingerprint, '.png').catch(error => error)
  expect(error).toBeInstanceOf(ApiError)
  expect(error.code).toBe(code)
  expect(mocks.query).toHaveBeenCalledTimes(2)
})
it('a completed replay checks current note ownership and strips private cache extensions', async () => {
  Object.assign(mocks.row, { state: 'completed', note_id: noteId, result: { ...dto, password_hash: 'private', companyId: 'private', author: { email: 'private' } } })
  expect(await registry.reserve(key, fingerprint, '.png')).toEqual({ kind: 'replay', expense: dto })
  expect(mocks.query).toHaveBeenLastCalledWith(expect.stringContaining('WHERE id=$1 AND user_id=$2'), [noteId, actor.id])
  expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO expense_submission_attempts'))).toBe(false)
})
it('an invisible original note cannot be recovered from cached JSON alone', async () => {
  Object.assign(mocks.row, { state: 'completed', note_id: noteId, result: dto })
  mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('SELECT *, expires_at') ? [mocks.row] : [] }))
  await expect(registry.reserve(key, fingerprint, '.png')).rejects.toMatchObject({ code: 'not_found' })
})
it('invalid cached field types fail instead of inventing or leaking a result', async () => {
  Object.assign(mocks.row, { state: 'completed', note_id: noteId, result: { ...dto, amount: '12.30private' } })
  await expect(registry.reserve(key, fingerprint, '.png')).rejects.toThrow('Invalid expense row')
})
it('an expired lease retires the old attempt before allocating another unique receipt reference', async () => {
  Object.assign(mocks.row, { state: 'processing', current_attempt_id: key, lease_active: false })
  const result = await registry.reserve(key, fingerprint, '.jpg')
  expect(mocks.query).toHaveBeenNthCalledWith(3, expect.stringContaining("state='retired'"), [opId, key])
  expect(result.kind === 'attempt' && result.claim.attemptId).not.toBe(key)
})
it('failure recording cannot replace completed or newer attempts', async () => {
  const claim = { operationId: opId, attemptId: key, userId: actor.id, companyId: actor.companyId, receiptKey: `receipts/${key}.png` }
  for (const row of [{ state: 'completed', current_attempt_id: key }, { state: 'processing', current_attempt_id: noteId }]) {
    mocks.query.mockClear(); mocks.row = row
    await registry.retireFailedAttempt(claim)
    expect(mocks.query).toHaveBeenCalledOnce()
  }
})
it('claim scope is the fresh server actor, never a previous company claim', () => {
  const claim = { operationId: opId, attemptId: key, userId: actor.id, companyId: actor.companyId, receiptKey: `receipts/${key}.png` }
  expect(() => assertClaimScope(claim, { ...actor, companyId: 'changed-company' })).toThrow()
  expect(() => assertClaimScope(claim, { ...actor, id: 'other-user' })).toThrow()
})
