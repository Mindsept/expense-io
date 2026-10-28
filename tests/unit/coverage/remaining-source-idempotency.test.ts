import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn(), connect: vi.fn(), release: vi.fn(), upload: vi.fn(), remove: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/storage', () => ({ uploadReceipt: mocks.upload, removeReceipt: mocks.remove }))
vi.mock('pg', () => ({ Pool: class { query = mocks.query; connect = mocks.connect }, types: { setTypeParser: vi.fn() } }))
import { submitIdempotentExpense } from '@/application/submit-idempotent-expense'
import { POST as submit } from '@/app/api/expense-notes/route'
import { PostgresExpenseDecisionAdapter } from '@/adapters/PostgresExpenseDecisionAdapter'
import { actor, database } from './database-helper'
const input = { amount: '18.75', expenseDate: '2026-10-20', description: 'Taxi', buffer: Buffer.from('synthetic receipt'), mimeType: 'image/png', extension: '.png' as const }
const key = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', noteId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
let fingerprint = '', attempt = '', receiptKey = '', state = 'failed'
let fault: 'none' | 'upload' | 'retirement' | 'insert' | 'unknown-commit' = 'none'
let completed = false
const noteRow = () => ({ id: noteId, user_id: actor.id, amount: input.amount, expense_date: input.expenseDate, description: input.description, status: 'pending', receipt_key: receiptKey, created_at: '2026-10-20T10:00:00Z' })
const noteDto = () => ({ id: noteId, userId: actor.id, amount: 18.75, expenseDate: input.expenseDate, description: input.description, status: 'pending', receiptKey, createdAt: '2026-10-20T10:00:00.000Z' })
beforeEach(() => {
  vi.clearAllMocks(); globalThis.__pgPool = undefined; vi.stubEnv('DATABASE_URL', 'postgres://synthetic')
  fault = 'none'; state = 'failed'; fingerprint = ''; completed = false
  mocks.auth.mockResolvedValue({ user: { id: actor.id } }); mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release })
  mocks.upload.mockResolvedValue(undefined); mocks.remove.mockResolvedValue(undefined)
  for (const level of ['info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {})
  mocks.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.startsWith('SELECT id, company_id, role')) return { rows: [{ id: actor.id, company_id: actor.companyId, role: 'employee', is_active: true }] }
    if (sql.includes('INSERT INTO expense_submission_operations')) fingerprint = String(values[3])
    if (sql.includes('SELECT *, expires_at')) return { rows: [{ id: 'operation', fingerprint, state, current_attempt_id: attempt || null, note_id: completed ? noteId : null, result: completed ? noteDto() : null, expired: false, lease_active: false }] }
    if (sql.includes('INSERT INTO expense_submission_attempts')) { attempt = String(values[0]); receiptKey = String(values[5]) }
    if (sql.includes("UPDATE expense_submission_operations SET state='processing'")) { state = 'processing'; return { rows: [{ id: 'operation' }] } }
    if (sql.includes('SELECT id FROM expense_submission_operations')) return { rows: [{ id: 'operation' }] }
    if (sql.includes('SELECT state,current_attempt_id')) {
      if (fault === 'retirement') throw new Error('retirement unavailable')
      return { rows: [{ state, current_attempt_id: attempt, lease_active: true }] }
    }
    if (sql.includes('INSERT INTO expense_notes')) { if (fault === 'insert') throw new Error('insert refused'); return { rows: [noteRow()] } }
    if (sql.includes("SET state='completed'")) { state = 'completed'; completed = true; return { rows: [{ id: 'operation' }] } }
    if (sql.includes("SET state='committed'")) return { rows: [{ id: attempt }] }
    if (sql.includes("UPDATE expense_submission_operations SET state='failed'")) { state = 'failed'; return { rows: [{ id: 'operation' }] } }
    if (sql.startsWith('SELECT id FROM expense_notes')) return { rows: [{ id: noteId }] }
    if (sql === 'COMMIT' && completed && fault === 'unknown-commit') throw new Error('commit acknowledgement unavailable')
    return { rows: [] }
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); globalThis.__pgPool = undefined })
it('persists one complete note and replays the durable result without uploading twice', async () => {
  expect(await submitIdempotentExpense(input, key, { requestId: key })).toEqual({ expense: noteDto(), replayed: false })
  expect(mocks.upload).toHaveBeenCalledExactlyOnceWith(receiptKey, input.buffer, 'image/png')
  expect(await submitIdempotentExpense(input, key, { requestId: key })).toEqual({ expense: noteDto(), replayed: true })
  expect(mocks.upload).toHaveBeenCalledOnce(); expect(mocks.remove).not.toHaveBeenCalled()
})
it('exposes durable replay through the HTTP submission contract', async () => {
  const receipt = readFileSync('tests/fixtures/leandro/LE-01/valid.png')
  const request = () => {
    const form = new FormData()
    for (const [name, value] of Object.entries({ amount: input.amount, expenseDate: input.expenseDate, description: input.description })) form.set(name, value)
    form.set('receipt', new File([receipt], 'synthetic.png', { type: 'image/png' }))
    return new Request('http://localhost/api/expense-notes', { method: 'POST', headers: { 'Idempotency-Key': key }, body: form })
  }
  const created = await submit(request()), replayed = await submit(request())
  expect(created.status).toBe(201); expect(created.headers.get('idempotency-replayed')).toBe('false')
  expect(replayed.status).toBe(201); expect(replayed.headers.get('idempotency-replayed')).toBe('true')
  expect(await replayed.json()).toEqual(await created.json()); expect(mocks.upload).toHaveBeenCalledOnce()
})
it.each(['upload', 'retirement', 'insert'] as const)('preserves the original %s error and retires recoverable attempts', async failure => {
  fault = failure
  if (failure !== 'insert') mocks.upload.mockRejectedValue(new Error('upload unavailable'))
  await expect(submitIdempotentExpense(input, key, { requestId: key })).rejects.toThrow(failure === 'insert' ? 'insert refused' : 'upload unavailable')
  expect(mocks.remove).toHaveBeenCalledWith(receiptKey)
  if (failure === 'retirement') expect(console.error).toHaveBeenCalledWith(expect.stringContaining('operation_state_unconfirmed'))
  else expect(state).toBe('failed')
})
it('preserves the upload failure when both retirement and diagnostic output fail', async () => {
  fault = 'retirement'; mocks.upload.mockRejectedValue(new Error('upload unavailable')); vi.mocked(console.error).mockImplementation(() => { throw new Error('logger unavailable') })
  await expect(submitIdempotentExpense(input, key, { requestId: key })).rejects.toThrow('upload unavailable')
})
it('keeps the receipt after an uncertain commit instead of corrupting a possibly committed note', async () => {
  fault = 'unknown-commit'
  await expect(submitIdempotentExpense(input, key, { requestId: key })).rejects.toThrow('commit acknowledgement unavailable')
  expect(mocks.remove).not.toHaveBeenCalled(); expect(console.error).toHaveBeenCalledWith(expect.stringContaining('commit_unconfirmed'))
  expect(state).toBe('completed')
})
it('maps decision visibility, transitions and immutable audit events', async () => {
  receiptKey = 'receipts/synthetic.png'
  const db = database(sql => ({ rows: sql.startsWith('SELECT en.id') ? [{ id: noteId, user_id: 'owner', status: 'pending' }] : sql.startsWith('UPDATE expense_notes') ? [{ ...noteRow(), status: 'approved' }] : [{ id: 'event', decided_at: new Date('2026-10-20T12:00:00Z') }] }))
  const adapter = new PostgresExpenseDecisionAdapter(db.client), decision = { actor, expenseId: noteId, decision: 'approved' as const }
  expect(await adapter.findVisible(decision)).toEqual({ id: noteId, ownerId: 'owner', status: 'pending' })
  expect(await adapter.transitionPending(decision)).toMatchObject({ id: noteId, status: 'approved' })
  const event = await adapter.appendHistory(decision, 'owner')
  expect(event).toEqual({ id: 'event', expenseId: noteId, companyId: actor.companyId, ownerId: 'owner', actorId: actor.id, fromStatus: 'pending', toStatus: 'approved', decidedAt: '2026-10-20T12:00:00.000Z' })
  expect(Object.isFrozen(event)).toBe(true)
  db.query.mockResolvedValue({ rows: [] })
  expect(await adapter.findVisible(decision)).toBeNull(); expect(await adapter.transitionPending(decision)).toBeNull()
  await expect(adapter.appendHistory(decision, 'owner')).rejects.toThrow('Decision history was not recorded')
})
