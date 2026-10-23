import type { DecideExpenseInput, ExpenseDecisionEvent, ExpenseDecisionPort } from '@/ports/ExpenseDecisionPort'

export class ExpenseDecisionError extends Error {
  constructor(readonly reason: 'not_found' | 'conflict' | 'forbidden' | 'validation') {
    super(reason)
    this.name = 'ExpenseDecisionError'
  }
}

/** A one-way pending -> approved/rejected decision; repeat attempts are conflicts. */
export class DecideExpense<TExpense> {
  constructor(private readonly persistence: ExpenseDecisionPort<TExpense>) {}

  async execute(input: DecideExpenseInput): Promise<{ expense: TExpense; event: ExpenseDecisionEvent }> {
    if (input.actor.role !== 'manager' && input.actor.role !== 'hr_admin') {
      throw new ExpenseDecisionError('forbidden')
    }
    if (input.decision !== 'approved' && input.decision !== 'rejected') {
      throw new ExpenseDecisionError('validation')
    }
    const visible = await this.persistence.findVisible(input)
    if (!visible) throw new ExpenseDecisionError('not_found')
    if (visible.status !== 'pending') throw new ExpenseDecisionError('conflict')
    const expense = await this.persistence.transitionPending(input)
    if (expense === null) {
      // A concurrent winner is a conflict only while the resource is still visible.
      if (!await this.persistence.findVisible(input)) throw new ExpenseDecisionError('not_found')
      throw new ExpenseDecisionError('conflict')
    }
    const event = await this.persistence.appendHistory(input, visible.ownerId)
    return { expense, event }
  }
}
