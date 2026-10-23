import { createDecideExpenseService } from '@/application/decide-expense'
import { observeDecision } from '@/observability/diagnostics'

/** Composition only: HA-03 still owns authorization, transaction, logs and outcome. */
export const decideExpenseForCurrentActor = createDecideExpenseService({ observe: observeDecision })
