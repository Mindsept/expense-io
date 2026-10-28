import { afterEach, describe, expect, it, vi } from 'vitest'
import { reconcileSubmissions, reconciliationOptions } from '@/lib/submission-reconciliation.mjs'
import { actor, database, eventId } from './database-helper'

const candidate = { id: eventId, operation_id: actor.id, extension: '.png', receipt_key: `receipts/${eventId}.png`, referenced: false, state: 'retired', old_enough: true }
const operation = { state: 'processing', current_attempt_id: eventId, lease_expired: true }
afterEach(() => vi.restoreAllMocks())
function fixture(options: { candidate?: Record<string, unknown>; operation?: Record<string, unknown> | null; allowed?: boolean; referenced?: boolean; fail?: string; commitFailure?: boolean } = {}) {
  let commits = 0
  return database(sql => {
    if (options.fail && sql.includes(options.fail)) throw Object.assign(new Error('failure'), { code: options.fail === 'FOR UPDATE NOWAIT' ? '55P03' : 'XX000' })
    if (sql === 'COMMIT' && ++commits === 2 && options.commitFailure) throw new Error('connection lost')
    if (sql.includes('AS allowed')) return { rows: [{ allowed: options.allowed ?? true }] }
    if (sql.includes('SELECT a.id')) return { rows: [{ ...candidate, ...options.candidate }] }
    if (sql.includes('SELECT state,current_attempt_id')) return { rows: options.operation === null ? [] : [{ ...operation, ...options.operation }] }
    if (sql.includes('SELECT *,created_at')) return { rows: [{ ...candidate, ...options.candidate }] }
    if (sql.includes('SELECT 1 FROM expense_notes')) return { rows: options.referenced ? [{}] : [] }
    return { rows: [] }
  })
}
describe('submission reconciliation', () => {
  it.each([{ companyId: 'invalid' }, { limit: 0 }, { limit: 101 }, { minAgeMs: 1 }, { maxDurationMs: 999 }, { maxDurationMs: 120001 }])('validates the maintenance scope %j', patch => {
    expect(() => reconciliationOptions({ companyId: actor.companyId, ...patch })).toThrow('Invalid reconciliation options')
  })
  it.each([false, true])('reports a dry run without removing receipts (referenced=%s)', async referenced => {
    const db = fixture({ candidate: { referenced } }), removeReceipt = vi.fn()
    expect(await reconcileSubmissions({ pool: db.pool, companyId: actor.companyId, removeReceipt })).toMatchObject({ mode: 'dry-run', processed: 1, items: [{ status: referenced ? 'referenced' : 'would_delete' }] })
    expect(removeReceipt).not.toHaveBeenCalled()
  })
  it.each([
    [{ candidate: { receipt_key: 'foreign/key' } }, 'invalid_reference'],
    [{ candidate: { extension: '.exe' } }, 'invalid_reference'],
    [{ candidate: { old_enough: false } }, 'skipped'],
    [{ candidate: { state: 'committed' } }, 'skipped'],
    [{ operation: null }, 'skipped'],
    [{ operation: { state: 'completed' } }, 'skipped'],
    [{ operation: { lease_expired: false } }, 'skipped'],
    [{ referenced: true }, 'referenced'],
    [{ fail: 'FOR UPDATE NOWAIT' }, 'busy'],
    [{ fail: 'UPDATE expense_submission_operations' }, 'database_error'],
    [{ commitFailure: true }, 'state_unknown'],
  ] as const)('refuses unsafe deletion: %j', async (options, expected) => {
    const db = fixture(options), removeReceipt = vi.fn()
    const result = await reconcileSubmissions({ pool: db.pool, companyId: actor.companyId, apply: true, removeReceipt })
    expect(result.items[0].status).toBe(expected)
    expect(removeReceipt).not.toHaveBeenCalled()
    expect(db.release).toHaveBeenCalledTimes(db.connect.mock.calls.length)
  })
  it.each(['deleted', 'cleanup_failed', 'state_unknown'])('reports the durable cleanup outcome %s', async expected => {
    const db = fixture(expected === 'state_unknown' ? { fail: 'cleanup_result=$3' } : {})
    const removeReceipt = vi.fn(async () => { if (expected === 'cleanup_failed') throw new Error('S3 unavailable') })
    const result = await reconcileSubmissions({ pool: db.pool, companyId: actor.companyId, apply: true, removeReceipt })
    expect(result.items[0].status).toBe(expected)
    expect(removeReceipt).toHaveBeenCalledWith(candidate.receipt_key, expect.any(Number))
    expect(db.release).toHaveBeenCalledTimes(db.connect.mock.calls.length)
    const commits = db.query.mock.calls.flatMap(([sql], index) => sql === 'COMMIT' ? [db.query.mock.invocationCallOrder[index]] : [])
    const deletedAt = removeReceipt.mock.invocationCallOrder[0]
    const stampIndex = db.query.mock.calls.findIndex(([sql]) => sql.includes('cleanup_result=$3'))
    // The durable fence must precede S3 deletion; recording the outcome follows it.
    expect(commits.length).toBeGreaterThanOrEqual(2)
    expect(commits[1]).toBeLessThan(deletedAt)
    expect(stampIndex).toBeGreaterThan(-1)
    expect(db.query.mock.invocationCallOrder[stampIndex]).toBeGreaterThan(deletedAt)
  })
  it('refuses application credentials and releases its connection', async () => {
    const db = fixture({ allowed: false }), removeReceipt = vi.fn()
    await expect(reconcileSubmissions({ pool: db.pool, companyId: actor.companyId, apply: true, removeReceipt })).rejects.toThrow('privileged maintenance login')
    expect(removeReceipt).not.toHaveBeenCalled(); expect(db.release).toHaveBeenCalledOnce()
  })
  it('honors the time budget before starting another receipt', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(30001)
    const db = fixture(), removeReceipt = vi.fn()
    expect(await reconcileSubmissions({ pool: db.pool, companyId: actor.companyId, apply: true, removeReceipt })).toMatchObject({ processed: 0, scanned: 1, budgetExhausted: true })
    expect(removeReceipt).not.toHaveBeenCalled()
  })
})
