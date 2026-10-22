import type { ExpenseNoteStatus } from '@/domain/ExpenseNote'
import type { UserRole } from '@/domain/User'

export type ExpenseDecision = 'approved' | 'rejected'
export type DecisionActor = Readonly<{ id: string; companyId: string; role: UserRole }>
export type DecideExpenseInput = Readonly<{ expenseId: string; actor: DecisionActor; decision: ExpenseDecision }>
export type VisibleExpenseState = Readonly<{ id: string; ownerId: string; status: ExpenseNoteStatus }>
export type ExpenseDecisionEvent = Readonly<{
  id: string
  expenseId: string
  companyId: string
  ownerId: string
  actorId: string
  fromStatus: 'pending'
  toStatus: ExpenseDecision
  decidedAt: string
}>

/**
 * Every method participates in one transaction owned by the application service.
 * Lock the current actor and author relation until commit. transitionPending must
 * compare pending AND authorization atomically, even after findVisible succeeds.
 */
export interface ExpenseDecisionPort<TExpense> {
  findVisible(input: DecideExpenseInput): Promise<VisibleExpenseState | null>
  transitionPending(input: DecideExpenseInput): Promise<TExpense | null>
  appendHistory(input: DecideExpenseInput, ownerId: string): Promise<ExpenseDecisionEvent>
}
