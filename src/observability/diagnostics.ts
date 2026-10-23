import type { HttpDiagnostic } from '@/lib/errors'
import type { DecisionDiagnostic } from '@/application/decide-expense'
import { ObservationRegistry, sanitizeDiagnostic } from '@/observability/registry.mjs'

const registry = new ObservationRegistry()
export const observationSnapshot = () => registry.snapshot()
/** HA-07 already writes its event: do not duplicate the HTTP log. */
export function observeHttp(event: HttpDiagnostic): void { try { registry.record(event) } catch {} }
/** HA-03 already writes its event: attach the published hook by composition. */
export function observeDecision(event: DecisionDiagnostic): void { try { registry.record(event) } catch {} }
export type PhaseOperation = 'storage.upload' | 'storage.remove' | 'expense.persist' | 'ocr.recognize'
export type PhaseCode = 'success' | 'storage_upload_failed' | 'storage_delete_failed' | 'persist_not_committed' | 'persist_commit_unknown' |
  'ocr_suggested' | 'ocr_empty' | 'ocr_timeout' | 'ocr_busy' | 'ocr_failed' | 'request_aborted'
export type Capacity = { workers: number; active: number; queued: number; stopping: number }
export type PhaseContext = { requestId?: string }

/** Adapter to the existing structured stdout channel, never a second transport. */
export function recordPhase(operation: PhaseOperation, durationMs: number, code: PhaseCode, context: PhaseContext, capacity?: Capacity): void {
  try {
    const event = sanitizeDiagnostic({ schema: 'expense.phase.v1', operation, durationMs, code, requestId: context.requestId, capacity })
    if (!event) return
    registry.record({ ...event, schema: 'expense.phase.v1' })
    console.info(JSON.stringify({ ...event, schema: 'expense.phase.v1' }))
  } catch { /* No diagnostic failure may change an application result. */ }
}

export async function measurePhase<T>(operation: PhaseOperation, context: PhaseContext, task: () => Promise<T>,
  success: (value: T) => PhaseCode, failure: (error: unknown) => PhaseCode, capacity?: () => Capacity): Promise<T> {
  const started = performance.now()
  const fallbackFailure: Record<PhaseOperation, PhaseCode> = { 'storage.upload': 'storage_upload_failed', 'storage.remove': 'storage_delete_failed', 'expense.persist': 'persist_commit_unknown', 'ocr.recognize': 'ocr_failed' }
  let code: PhaseCode = fallbackFailure[operation]
  try {
    const value = await task()
    try { code = success(value) } catch { code = 'success' }
    return value
  } catch (error) {
    try { code = failure(error) } catch { code = fallbackFailure[operation] }
    throw error
  } finally {
    try { recordPhase(operation, Math.max(0, performance.now() - started), code, context, capacity?.()) } catch {}
  }
}
