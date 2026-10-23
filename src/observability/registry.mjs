const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const httpOperations = new Set(['expense-notes.list', 'expense-notes.submit', 'expense-notes.receipt-suggestion',
  'expense-notes.receipt-url', 'expense-notes.history', 'manager.expense-notes.list',
  'manager.expense-notes.approve', 'manager.expense-notes.reject', 'manager.expense-notes.receipt-url',
  'hr.expense-notes.list', 'hr.expense-notes.approve', 'hr.expense-notes.reject', 'hr.expense-notes.receipt-url',
  'hr.users.list', 'hr.users.manager'])
const phaseCodes = new Map([
  ['storage.upload', new Set(['success', 'storage_upload_failed'])],
  ['storage.remove', new Set(['success', 'storage_delete_failed'])],
  ['expense.persist', new Set(['success', 'persist_not_committed', 'persist_commit_unknown'])],
  ['ocr.recognize', new Set(['ocr_suggested', 'ocr_empty', 'ocr_timeout', 'ocr_busy', 'ocr_failed', 'request_aborted'])],
])
export const latencyBoundsMs = Object.freeze([10, 50, 100, 500, 1000, 5000, 20000, 60000, 300000])

/** Rebuild each record from allowlists; never retain arbitrary fields or raw errors. */
export function sanitizeDiagnostic(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.operation !== 'string' ||
      !Number.isFinite(value.durationMs) || value.durationMs < 0 || value.durationMs > Number.MAX_SAFE_INTEGER) return undefined
  const requestId = typeof value.requestId === 'string' && uuid.test(value.requestId) ? value.requestId.toLowerCase() : undefined
  let result, code, status
  if (httpOperations.has(value.operation)) {
    if (!requestId || !Number.isInteger(value.status) || value.status < 200 || value.status > 599) return undefined
    status = value.status
    result = status >= 500 ? 'server_error' : status >= 400 ? 'client_error' : 'success'
    code = `http_${Math.floor(status / 100)}xx`
  } else if (value.operation === 'DecideExpense') {
    if (!['success', 'conflict', 'denied', 'error'].includes(value.result)) return undefined
    result = value.result; code = `decision_${result}`
  } else if (value.schema === 'expense.phase.v1' && phaseCodes.get(value.operation)?.has(value.code)) {
    code = value.code
    result = ['success', 'ocr_suggested', 'ocr_empty'].includes(code) ? 'success' : 'error'
  } else return undefined
  const event = { operation: value.operation, durationMs: Math.min(300000, value.durationMs), result, code, attempt: 1,
    ...(value.durationMs > 300000 || value.durationCapped === true ? { durationCapped: true } : {}),
    ...(requestId ? { requestId } : {}), ...(status ? { status } : {}) }
  if (value.operation === 'ocr.recognize') {
    const gauges = value.capacity
    if (gauges && Number.isInteger(gauges.workers) && gauges.workers >= 0 && gauges.workers <= 4 &&
        Number.isInteger(gauges.active) && gauges.active >= 0 && gauges.active <= gauges.workers &&
        Number.isInteger(gauges.queued) && gauges.queued >= 0 && gauges.queued <= 16 &&
        Number.isInteger(gauges.stopping) && gauges.stopping >= 0 && gauges.stopping <= gauges.workers) {
      event.capacity = { workers: gauges.workers, active: gauges.active, queued: gauges.queued, stopping: gauges.stopping }
    }
  }
  return Object.freeze(event)
}

/** Finite operation/code/result domain. IDs can never become keys or labels. */
export class ObservationRegistry {
  constructor() { this.series = new Map(); this.capacity = undefined }
  record(value) {
    const event = sanitizeDiagnostic(value)
    if (!event) return undefined
    const key = `${event.operation}/${event.code}/${event.result}`
    let row = this.series.get(key)
    if (!row) {
      row = { operation: event.operation, code: event.code, result: event.result, count: 0, sumDurationMs: 0,
        buckets: latencyBoundsMs.map(leMs => ({ leMs, count: 0 })) }
      this.series.set(key, row)
    }
    row.count = Math.min(Number.MAX_SAFE_INTEGER, row.count + 1)
    row.sumDurationMs = Math.min(Number.MAX_SAFE_INTEGER, row.sumDurationMs + event.durationMs)
    for (const bucket of row.buckets) if (event.durationMs <= bucket.leMs) bucket.count = Math.min(Number.MAX_SAFE_INTEGER, bucket.count + 1)
    if (event.capacity) this.capacity = event.capacity
    return event
  }
  snapshot() {
    return { schema: 'expense.metrics.v1', scope: 'process-or-explicit-log-input',
      series: [...this.series.values()].sort((a, b) => `${a.operation}/${a.code}`.localeCompare(`${b.operation}/${b.code}`))
        .map(row => ({ ...row, buckets: row.buckets.map(bucket => ({ ...bucket })) })),
      ...(this.capacity ? { capacity: { ...this.capacity } } : {}) }
  }
}
