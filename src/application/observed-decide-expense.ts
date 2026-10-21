import { createDecideExpenseService } from '@/application/decide-expense'
import { enqueueDecisionNotification } from '@/lib/notifications/inbox'
import { observeDecision } from '@/observability/diagnostics'

/** Composition only: HA-03 still owns authorization, transaction, logs and outcome. */
export const decideExpenseForCurrentActor = createDecideExpenseService({ observe: observeDecision, extendTransaction: enqueueDecisionNotification })
