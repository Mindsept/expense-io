import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PoolClient } from 'pg'

const mocks = vi.hoisted(() => ({ currentActor: vi.fn(), findVisible: vi.fn(), transition: vi.fn(), append: vi.fn() }))
vi.mock('@/lib/current-actor', () => ({ withCurrentActor: mocks.currentActor }))
vi.mock('@/adapters/PostgresExpenseDecisionAdapter', () => ({
  PostgresExpenseDecisionAdapter: vi.fn(function () {
    return { findVisible: mocks.findVisible, transitionPending: mocks.transition, appendHistory: mocks.append }
  }),
}))
import { createDecideExpenseService, type DecisionDiagnostic } from '@/application/decide-expense'
import { ApiError, withApiHandler } from '@/lib/errors'

const requestId = '11111111-1111-4111-8111-111111111111'
const input = { expenseId: 'expense', decision: 'approved' as const, requiredRole: 'manager' as const, requestId }
const client = { query: vi.fn() } as unknown as PoolClient
const actor = { id: 'actor', companyId: 'company', role: 'manager' }
const event = { id: 'event', expenseId: 'expense', companyId: 'company', ownerId: 'owner', actorId: 'actor', fromStatus: 'pending', toStatus: 'approved', decidedAt: '2026-10-21T10:00:00.000Z' }
const secret = 'private-sentinel-SQL-password-receipt'
let logs: string[]

beforeEach(() => {
  vi.resetAllMocks()
  logs = []
  vi.spyOn(console, 'info').mockImplementation((message: string) => { logs.push(message) })
  mocks.currentActor.mockImplementation(async (_role, work) => work(client, actor))
  mocks.findVisible.mockResolvedValue({ id: 'expense', ownerId: 'owner', status: 'pending' })
  mocks.transition.mockResolvedValue({ id: 'expense', status: 'approved' })
  mocks.append.mockResolvedValue(event)
})
afterEach(() => vi.restoreAllMocks())

describe('transaction composition and diagnostic extension', () => {
  it('passes the transaction client and stable recorded event to the extension before commit', async () => {
    const order: string[] = []
    const extendTransaction = vi.fn(async () => { order.push('extension') })
    const observe = vi.fn(() => { order.push('observer') })
    mocks.currentActor.mockImplementation(async (_role, work) => {
      const result = await work(client, actor)
      order.push('commit')
      return result
    })
    await expect(createDecideExpenseService({ observe, extendTransaction })(input)).resolves.toEqual({ id: 'expense', status: 'approved' })
    expect(extendTransaction).toHaveBeenCalledWith(client, event)
    expect(order).toEqual(['extension', 'commit', 'observer'])
  })

  it.each(['success', 'conflict', 'denied', 'error'] as const)('emits an immutable, sanitized %s result', async (outcome) => {
    const events: DecisionDiagnostic[] = []
    if (outcome === 'conflict') mocks.findVisible.mockResolvedValue({ id: 'expense', ownerId: 'owner', status: 'approved' })
    if (outcome === 'denied') mocks.findVisible.mockResolvedValue(null)
    if (outcome === 'error') mocks.append.mockRejectedValue(new Error(secret))
    const promise = createDecideExpenseService({ observe: (diagnostic) => { events.push(diagnostic) } })(input)
    if (outcome === 'success') await promise
    else await expect(promise).rejects.toThrow()
    expect(events).toEqual([{ operation: 'DecideExpense', durationMs: expect.any(Number), result: outcome, requestId }])
    expect(events[0].durationMs).toBeGreaterThanOrEqual(0)
    expect(Object.isFrozen(events[0])).toBe(true)
    expect(JSON.stringify(events) + logs.join()).not.toContain(secret)
    expect(JSON.stringify(events)).not.toContain('actor')
  })

  it.each(['forbidden', 'unauthenticated'] as const)('measures %s before the use case starts', async (code) => {
    mocks.currentActor.mockRejectedValue(new ApiError(code))
    const observe = vi.fn()
    await expect(createDecideExpenseService({ observe })(input)).rejects.toMatchObject({ code })
    expect(observe).toHaveBeenCalledWith(expect.objectContaining({ result: 'denied' }))
    expect(mocks.findVisible).not.toHaveBeenCalled()
  })

  it('does not measure a successful update as success when COMMIT fails', async () => {
    mocks.currentActor.mockImplementation(async (_role, work) => {
      await work(client, actor)
      throw new Error(secret)
    })
    const observe = vi.fn()
    await expect(createDecideExpenseService({ observe })(input)).rejects.toThrow(secret)
    expect(observe).toHaveBeenCalledWith(expect.objectContaining({ result: 'error' }))
  })

  it('propagates transactional extension failure to the enclosing transaction', async () => {
    const failure = new Error(secret)
    const extendTransaction = vi.fn().mockRejectedValue(failure)
    await expect(createDecideExpenseService({ extendTransaction })(input)).rejects.toBe(failure)
    expect(logs.join()).not.toContain(secret)
  })

  it.each(['throw', 'reject', 'pending'] as const)('isolates an observer that will %s', async (behavior) => {
    const observe = () => {
      if (behavior === 'throw') throw new Error(secret)
      if (behavior === 'reject') return Promise.reject(new Error(secret))
      return new Promise<void>(() => {})
    }
    await expect(createDecideExpenseService({ observe })(input)).resolves.toEqual({ id: 'expense', status: 'approved' })
    await Promise.resolve()
    expect(logs.join()).not.toContain(secret)
  })

  it('drops an invalid correlation ID instead of logging it', async () => {
    const observe = vi.fn()
    await createDecideExpenseService({ observe })({ ...input, requestId: secret })
    expect(observe.mock.calls[0][0]).not.toHaveProperty('requestId')
    expect(logs.join()).not.toContain(secret)
  })

  it('passes generated HTTP correlation through to decision diagnostics', async () => {
    const observe = vi.fn()
    const service = createDecideExpenseService({ observe })
    const response = await withApiHandler(new Request('http://localhost'), 'manager.expense-notes.approve', async (context) => {
      expect(Object.isFrozen(context)).toBe(true)
      return Response.json(await service({ ...input, requestId: context.requestId }))
    })
    expect(observe.mock.calls[0][0].requestId).toBe(response.headers.get('x-request-id'))
  })
})
