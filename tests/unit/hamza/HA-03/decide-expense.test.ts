import { describe, expect, it, vi } from 'vitest'
import { DecideExpense, ExpenseDecisionError } from '@/domain/DecideExpense'
import type { DecideExpenseInput, ExpenseDecision, ExpenseDecisionPort } from '@/ports/ExpenseDecisionPort'

const actor = { id: 'actor', companyId: 'company', role: 'manager' as const }
const input: DecideExpenseInput = { expenseId: 'expense', actor, decision: 'approved' }
function persistence() {
  return {
    findVisible: vi.fn().mockResolvedValue({ id: 'expense', ownerId: 'owner', status: 'pending' }),
    transitionPending: vi.fn().mockResolvedValue({ id: 'expense', status: 'approved' }),
    appendHistory: vi.fn().mockResolvedValue({
      id: 'event', expenseId: 'expense', companyId: 'company', ownerId: 'owner', actorId: 'actor',
      fromStatus: 'pending', toStatus: 'approved', decidedAt: '2026-10-21T10:00:00.000Z',
    }),
  } satisfies ExpenseDecisionPort<{ id: string; status: string }>
}

async function reason(promise: Promise<unknown>, expected: string) {
  await expect(promise).rejects.toMatchObject({ name: 'ExpenseDecisionError', reason: expected })
}

describe('DecideExpense business transition', () => {
  it.each(['approved', 'rejected'] as const)('records a pending -> %s transition and its event', async (decision) => {
    const port = persistence()
    port.transitionPending.mockResolvedValue({ id: 'expense', status: decision })
    port.appendHistory.mockResolvedValue({ id: 'event', toStatus: decision })
    const result = await new DecideExpense<{ id: string; status: string }>(port).execute({ ...input, decision })
    expect(result.expense.status).toBe(decision)
    expect(port.transitionPending).toHaveBeenCalledWith({ ...input, decision })
    expect(port.appendHistory).toHaveBeenCalledWith({ ...input, decision }, 'owner')
    expect(port.transitionPending.mock.invocationCallOrder[0]).toBeLessThan(port.appendHistory.mock.invocationCallOrder[0])
  })

  it('refuses an employee before persistence access', async () => {
    const port = persistence()
    await reason(new DecideExpense(port).execute({ ...input, actor: { ...actor, role: 'employee' } }), 'forbidden')
    expect(port.findVisible).not.toHaveBeenCalled()
  })

  it('rejects an unknown transition at runtime', async () => {
    const port = persistence()
    await reason(new DecideExpense(port).execute({ ...input, decision: 'pending' as ExpenseDecision }), 'validation')
    expect(port.findVisible).not.toHaveBeenCalled()
  })

  it('returns the same not-found result for missing or hidden resources', async () => {
    const port = persistence()
    port.findVisible.mockResolvedValue(null)
    await reason(new DecideExpense(port).execute(input), 'not_found')
    expect(port.transitionPending).not.toHaveBeenCalled()
    expect(port.appendHistory).not.toHaveBeenCalled()
  })

  it.each(['approved', 'rejected'])('rejects a repeated decision from %s without appending', async (status) => {
    const port = persistence()
    port.findVisible.mockResolvedValue({ id: 'expense', ownerId: 'owner', status })
    await reason(new DecideExpense(port).execute(input), 'conflict')
    expect(port.transitionPending).not.toHaveBeenCalled()
    expect(port.appendHistory).not.toHaveBeenCalled()
  })

  it('returns conflict when the atomic compare loses to a concurrent visible decision', async () => {
    const port = persistence()
    port.transitionPending.mockResolvedValue(null)
    await reason(new DecideExpense(port).execute(input), 'conflict')
    expect(port.findVisible).toHaveBeenCalledTimes(2)
    expect(port.appendHistory).not.toHaveBeenCalled()
  })

  it('does not reveal a resource if it is no longer visible after a failed compare', async () => {
    const port = persistence()
    port.findVisible.mockResolvedValueOnce({ id: 'expense', ownerId: 'owner', status: 'pending' }).mockResolvedValueOnce(null)
    port.transitionPending.mockResolvedValue(null)
    await reason(new DecideExpense(port).execute(input), 'not_found')
    expect(port.appendHistory).not.toHaveBeenCalled()
  })

  it('propagates a history failure so the enclosing transaction can roll back', async () => {
    const port = persistence()
    const failure = new Error('history unavailable')
    port.appendHistory.mockRejectedValue(failure)
    await expect(new DecideExpense(port).execute(input)).rejects.toBe(failure)
  })

  it('does not wrap infrastructure errors as business conflicts', async () => {
    const port = persistence()
    const failure = new Error('connection unavailable')
    port.findVisible.mockRejectedValue(failure)
    await expect(new DecideExpense(port).execute(input)).rejects.toBe(failure)
    expect(failure).not.toBeInstanceOf(ExpenseDecisionError)
  })
})
