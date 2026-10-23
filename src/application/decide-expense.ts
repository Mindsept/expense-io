import type { PoolClient } from 'pg'
import { DecideExpense, ExpenseDecisionError } from '@/domain/DecideExpense'
import { PostgresExpenseDecisionAdapter } from '@/adapters/PostgresExpenseDecisionAdapter'
import { withCurrentActor } from '@/lib/current-actor'
import { ApiError } from '@/lib/errors'
import type { ExpenseDecision, ExpenseDecisionEvent } from '@/ports/ExpenseDecisionPort'

export type DecisionDiagnostic = Readonly<{
  operation: 'DecideExpense'
  durationMs: number
  result: 'success' | 'conflict' | 'denied' | 'error'
  requestId?: string
}>
export type DecisionObserver = (event: DecisionDiagnostic) => void | Promise<void>
/** HA-09 may append an outbox row using this exact client. No network sends; failures roll back. */
export type DecisionTransactionExtension = (client: PoolClient, event: ExpenseDecisionEvent) => Promise<void>

type Options = { observe?: DecisionObserver; extendTransaction?: DecisionTransactionExtension }
type Input = { expenseId: string; decision: ExpenseDecision; requiredRole: 'manager' | 'hr_admin'; requestId?: string }
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Composition seam: LE-08/HA-09 supply adapters without changing the domain or DB/error helpers. */
export function createDecideExpenseService({ observe, extendTransaction }: Options = {}) {
  return async (input: Input) => {
    const startedAt = performance.now()
    let result: DecisionDiagnostic['result'] = 'error'
    try {
      const expense = await withCurrentActor(input.requiredRole, async (client, actor) => {
        const useCase = new DecideExpense(new PostgresExpenseDecisionAdapter(client))
        const decided = await useCase.execute({ expenseId: input.expenseId, decision: input.decision, actor })
        await extendTransaction?.(client, decided.event)
        return decided.expense
      })
      // Success is recorded only after withCurrentActor's enclosing transaction has committed.
      result = 'success'
      return expense
    } catch (error) {
      const reason = error instanceof ExpenseDecisionError ? error.reason : error instanceof ApiError ? error.code : undefined
      if (reason === 'conflict') result = 'conflict'
      else if (reason === 'not_found' || reason === 'forbidden' || reason === 'unauthenticated') result = 'denied'
      if (error instanceof ExpenseDecisionError) throw new ApiError(error.reason)
      throw error
    } finally {
      const requestId = input.requestId && requestIdPattern.test(input.requestId) ? input.requestId.toLowerCase() : undefined
      const diagnostic = Object.freeze({
        operation: 'DecideExpense' as const, durationMs: Math.max(0, performance.now() - startedAt), result,
        ...(requestId ? { requestId } : {}),
      })
      // No actor, tenant, expense, token or exception data enters this diagnostic channel.
      try { console.info(JSON.stringify(diagnostic)) } catch { /* Logging does not change a decision. */ }
      try { void Promise.resolve(observe?.(diagnostic)).catch(() => {}) } catch { /* Isolate collector failures. */ }
    }
  }
}

export const decideExpenseForCurrentActor = createDecideExpenseService()
