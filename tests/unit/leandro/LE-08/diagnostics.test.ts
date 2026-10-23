import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { ObservationRegistry, sanitizeDiagnostic } from '@/observability/registry.mjs'
import { measurePhase, observeDecision, observeHttp, recordPhase } from '@/observability/diagnostics'
import { getClientErrorMessage } from '@/utils/client-errors'

const requestId = '11111111-1111-4111-8111-111111111111'
const phase = { schema: 'expense.phase.v1', operation: 'storage.upload', durationMs: 12, result: 'error', code: 'storage_upload_failed', requestId }
afterEach(() => vi.restoreAllMocks())
it('cannot create a metric series per identifier or retain secrets/unknown labels', () => {
  const registry = new ObservationRegistry()
  for (let index = 0; index < 1000; index++) registry.record({ ...phase, requestId: randomUUID(), email: `${index}@private.test`, noteId: randomUUID(), password: 'SECRET', signedUrl: 'https://private/?X-Amz-SECRET' })
  const snapshot = registry.snapshot()
  expect(snapshot.series).toHaveLength(1)
  expect(snapshot.series[0]).toMatchObject({ count: 1000, sumDurationMs: 12000, operation: 'storage.upload', code: 'storage_upload_failed' })
  expect(snapshot.series[0].buckets.find((bucket: { leMs: number }) => bucket.leMs === 50)?.count).toBe(1000)
  expect(JSON.stringify(snapshot)).not.toMatch(/requestId|noteId|email|password|SECRET|private/)
  registry.record({ ...phase, operation: `storage.upload/${randomUUID()}` })
  registry.record({ ...phase, code: `error/${randomUUID()}` })
  expect(registry.snapshot().series).toHaveLength(1)
})
it('normalizes native HA-07 and HA-03 events and snapshots cannot mutate internal counters', () => {
  const registry = new ObservationRegistry()
  registry.record({ operation: 'expense-notes.submit', requestId, status: 500, durationMs: 30, result: 'success' })
  registry.record({ operation: 'DecideExpense', requestId, durationMs: 20, result: 'conflict', expenseId: 'secret' })
  expect(registry.snapshot().series.map(row => row.code)).toEqual(['decision_conflict', 'http_5xx'])
  const snapshot = registry.snapshot(); snapshot.series[0].count = 0; snapshot.series[0].buckets[0].count = 999
  expect(registry.snapshot().series[0].count).toBe(1)
  expect(JSON.stringify(snapshot)).not.toContain('secret')
})
it.each([NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1])('rejects malformed duration %s rather than poisoning aggregates', durationMs => {
  expect(sanitizeDiagnostic({ ...phase, durationMs })).toBeUndefined()
})
it('keeps successful empty OCR distinct from failure and validates capacity gauges', () => {
  const registry = new ObservationRegistry()
  for (const code of ['ocr_empty', 'ocr_timeout', 'ocr_suggested']) registry.record({ ...phase, operation: 'ocr.recognize', code, capacity: { workers: 1, active: 0, queued: 0, stopping: 0, userId: 'SECRET' } })
  expect(registry.snapshot().series.map(row => [row.code, row.result])).toEqual([['ocr_empty', 'success'], ['ocr_suggested', 'success'], ['ocr_timeout', 'error']])
  expect(registry.snapshot().capacity).toEqual({ workers: 1, active: 0, queued: 0, stopping: 0 })
  expect(sanitizeDiagnostic({ ...phase, operation: 'ocr.recognize', code: 'ocr_empty', capacity: { workers: 999, active: 1, queued: 999 } })).not.toHaveProperty('capacity')
})
it('preserves success and the identical primary error when the diagnostic channel fails', async () => {
  vi.spyOn(console, 'info').mockImplementation(() => { throw new Error('Broken transport') })
  expect(await measurePhase('storage.upload', { requestId }, async () => 42, () => 'success', () => 'storage_upload_failed')).toBe(42)
  const failure = new Error('RAW PRIVATE SQL')
  await expect(measurePhase('storage.upload', { requestId }, async () => { throw failure }, () => 'success', () => { throw new Error('Bad classifier') })).rejects.toBe(failure)
  expect(() => recordPhase('storage.upload', 1, 'storage_upload_failed', { requestId })).not.toThrow()
  expect(() => observeHttp({ operation: 'expense-notes.submit', requestId, durationMs: 1, result: 'success', status: 201, level: 'info' })).not.toThrow()
  expect(() => observeDecision({ operation: 'DecideExpense', requestId, durationMs: 1, result: 'success' })).not.toThrow()
})
it('logs only reviewed fields/codes and reuses the supplied normalized request ID', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  const failure = new Error('SQL/SECRET/receipt')
  await expect(measurePhase('storage.upload', { requestId: requestId.toUpperCase() }, async () => { throw failure }, () => 'success', () => 'storage_upload_failed')).rejects.toBe(failure)
  const event = JSON.parse(log.mock.calls[0][0] as string)
  expect(event).toMatchObject({ requestId, attempt: 1, operation: 'storage.upload', code: 'storage_upload_failed', result: 'error' })
  expect(Object.keys(event).sort()).toEqual(['attempt','code','durationMs','operation','requestId','result','schema'])
  expect(JSON.stringify(event)).not.toMatch(/SQL|SECRET|receipt/)
})
it('shows a valid server correlation reference with the existing safe server message', async () => {
  const response = new Response('SECRET STACK', { status: 500, headers: { 'X-Request-Id': requestId.toUpperCase() } })
  expect(await getClientErrorMessage(response, 'fallback')).toBe(`Une erreur serveur est survenue. Réessaie plus tard. Référence : ${requestId}.`)
  expect(await getClientErrorMessage(new Response('SECRET', { status: 500, headers: { 'X-Request-Id': 'SECRET invalid ID' } }), 'fallback')).not.toContain('SECRET')
})
it('exports only allowlisted aggregate/correlation fields and bounds line size and matching results', () => {
  const input = [JSON.stringify({ ...phase, password: 'SECRET' }), 'private framework stack SECRET', 'x'.repeat(9000), ...Array.from({ length: 4 }, () => JSON.stringify(phase))].join('\n')
  const env = { ...process.env }; delete env.FORCE_COLOR
  const aggregate = spawnSync(process.execPath, ['scripts/leandro/LE-08/export.mjs', '--input', '-'], { input, env, encoding: 'utf8' })
  expect(aggregate.status).toBe(0); expect(aggregate.stderr).toBe('')
  expect(JSON.parse(aggregate.stdout).series).toHaveLength(1)
  expect(aggregate.stdout).not.toMatch(/requestId|SECRET|private|password/)
  const correlated = spawnSync(process.execPath, ['scripts/leandro/LE-08/export.mjs', '--input', '-', '--request-id', requestId, '--limit', '2'], { input, env, encoding: 'utf8' })
  expect(correlated.status).toBe(0)
  expect(JSON.parse(correlated.stdout)).toMatchObject({ mode: 'correlation', truncated: true, events: [expect.objectContaining({ requestId }), expect.objectContaining({ requestId })] })
  expect(correlated.stdout).not.toMatch(/SECRET|private|password/)
  const rejected = spawnSync(process.execPath, ['scripts/leandro/LE-08/export.mjs', '--input', 'SECRET_MISSING_PATH'], { env, encoding: 'utf8' })
  expect(rejected.status).toBe(1)
  expect(rejected.stderr).not.toContain('SECRET')
})

it('caps very slow timings explicitly without dropping their failure counts', () => {
  const registry = new ObservationRegistry()
  const event = registry.record({ ...phase, durationMs: 900000 })
  expect(event).toMatchObject({ durationMs: 300000, durationCapped: true })
  expect(registry.snapshot().series[0]).toMatchObject({ count: 1, sumDurationMs: 300000 })
  expect(registry.record(event && { ...event, schema: 'expense.phase.v1' })).toHaveProperty('durationCapped', true)
})
