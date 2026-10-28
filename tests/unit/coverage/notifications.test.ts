import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertNotificationWorker, deliverOneAssignment, deliverOneDecisionNotification, enqueueDecisionNotification, markAssignmentRead, markDecisionInboxRead, notificationInbox, PostgresInAppNotificationAdapter, readDecisionInbox, requeueFailedDecisionNotification, scanAssignments } from '@/lib/notifications/inbox'
import { actor, database, eventId } from './database-helper'
import type { ExpenseDecisionEvent } from '@/ports/ExpenseDecisionPort'

afterEach(() => vi.restoreAllMocks())
const policy = { maxAttempts: 3, retryDelaySeconds: 10 }
const event = { event_id: eventId, recipient_id: actor.id, expense_id: 'expense', decision: 'approved', attempts: 0 }
describe.each([
  { name: 'decision', deliver: deliverOneDecisionNotification },
  { name: 'assignment', deliver: deliverOneAssignment },
])('$name delivery transaction', ({ deliver }) => {
  it.each([{ maxAttempts: 0, retryDelaySeconds: 1 }, { maxAttempts: 11, retryDelaySeconds: 1 }, { maxAttempts: 2.5, retryDelaySeconds: 1 }, { maxAttempts: 1, retryDelaySeconds: -1 }, { maxAttempts: 1, retryDelaySeconds: 3601 }])('rejects an invalid retry policy %j', async input => {
    const db = database(() => ({ rows: [] }))
    await expect(deliver(db.pool, input)).rejects.toThrow('Invalid notification retry policy')
    expect(db.connect).not.toHaveBeenCalled()
  })
  it.each(['idle', 'delivered', 'retry', 'failed', 'exhausted'])('returns %s and commits its bounded outcome', async expected => {
    const db = database(sql => {
      if (sql.startsWith('SELECT event_id')) return { rows: expected === 'idle' ? [] : [{ ...event, attempts: expected === 'exhausted' ? 3 : expected === 'failed' ? 2 : 0 }] }
      if (sql.includes('SELECT 1 FROM public.') && sql.includes('_inbox')) return { rows: ['retry', 'failed'].includes(expected) ? [] : [{}] }
      if (sql.startsWith('SELECT 1 FROM public.assignment_notification_outbox')) return { rows: [{}] }
      return { rows: [] }
    })
    expect((await deliver(db.pool, policy)).outcome).toBe(expected === 'exhausted' ? 'failed' : expected)
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('COMMIT')
    expect(db.release).toHaveBeenCalledTimes(1)
    if (['retry', 'failed'].includes(expected)) expect(db.query.mock.calls.some(([sql]) => sql === 'ROLLBACK TO SAVEPOINT inbox_delivery')).toBe(true)
  })
  it.each([false, true])('rolls back technical failures and discards broken connections (rollback fails=%s)', async brokenRollback => {
    const db = database(sql => { if (sql.startsWith('SET LOCAL') || (brokenRollback && sql === 'ROLLBACK')) throw new Error('database credentials must not leak'); return { rows: [] } })
    await expect(deliver(db.pool, policy)).rejects.toThrow(/unavailable|could not complete/)
    expect(db.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true)
    expect(db.release).toHaveBeenCalledTimes(1)
    if (brokenRollback) expect(db.release).toHaveBeenCalledWith(true)
  })
})
it('hides connection errors from the decision worker', async () => {
  const db = database(() => ({ rows: [] })); db.connect.mockRejectedValue(new Error('private credential'))
  await expect(deliverOneDecisionNotification(db.pool, policy)).rejects.toThrow('The notification worker is unavailable.')
})
it('marks an assignment obsolete when its current rights are gone', async () => {
  const db = database(sql => ({ rows: sql.startsWith('SELECT event_id') ? [event] : [] }))
  expect(await deliverOneAssignment(db.pool, policy)).toEqual({ outcome: 'obsolete' })
  expect(db.query.mock.calls.some(([sql]) => sql.includes("state='obsolete'"))).toBe(true)
})
it.each([true, false])('enqueues a decision only if its recorded intent is visible (%s)', async visible => {
  const db = database(sql => ({ rows: sql.startsWith('SELECT 1') && visible ? [{}] : [] }))
  const promise = enqueueDecisionNotification(db.client, { id: eventId, expenseId: 'expense', ownerId: actor.id, companyId: actor.companyId, toStatus: 'approved' } as ExpenseDecisionEvent)
  if (visible) await expect(promise).resolves.toBeUndefined()
  else await expect(promise).rejects.toThrow('intent could not be recorded')
})
it('refuses notification delivery without an event identity', async () => {
  const db = database(() => ({ rows: [] }))
  await expect(new PostgresInAppNotificationAdapter(db.client).notifyDecision(actor.id, 'expense', 'approved')).rejects.toThrow('event is invalid')
  expect(db.query).not.toHaveBeenCalled()
})
it.each([markAssignmentRead, markDecisionInboxRead])('bounds mark-read to an existing actor-scoped UUID', async mark => {
  const date = new Date('2026-10-20T12:00:00Z')
  const db = database((_sql, values) => ({ rows: values[0] === eventId ? [{ event_id: eventId, read_at: date }] : [] }))
  expect(await mark(db.client, actor, 'bad')).toBeNull(); expect(db.query).not.toHaveBeenCalled()
  expect(await mark(db.client, actor, eventId)).toEqual({ eventId, readAt: date.toISOString() })
  expect(db.query.mock.calls.at(-1)?.[1]).toEqual([eventId, actor.id, actor.companyId])
  expect(await mark(db.client, actor, actor.id)).toBeNull()
})
it('maps dates and read states without exposing storage fields', async () => {
  const date = new Date('2026-10-20T12:00:00Z')
  const db = database(() => ({ rows: [{ ...event, created_at: date, read_at: null }, { ...event, created_at: date, read_at: date }] }))
  const result = await readDecisionInbox(db.client, actor)
  expect(result.map(row => row.readAt)).toEqual([null, date.toISOString()])
  expect(result[0]).toEqual({ eventId, expenseId: 'expense', decision: 'approved', createdAt: date.toISOString(), readAt: null })
})
it.each(['hr_admin', 'manager', 'employee'] as const)('routes the %s inbox to its permitted UI', async role => {
  const date = new Date('2026-10-20T12:00:00Z')
  const db = database(() => ({ rows: [{ ...event, kind: 'decision', created_at: date, read_at: null }, { ...event, kind: 'assignment', created_at: date, read_at: date }] }))
  expect((await notificationInbox(db.client, { ...actor, role })).map(row => row.href)).toEqual(['/expenses', role === 'manager' ? '/manager' : '/hr'])
})
it('permits requeue only for HR and returns whether an event changed', async () => {
  const db = database(() => ({ rows: [{}] }))
  expect(await requeueFailedDecisionNotification(db.client, eventId, { ...actor, role: 'employee' })).toBe(false)
  expect(db.query).not.toHaveBeenCalled()
  expect(await requeueFailedDecisionNotification(db.client, eventId, actor)).toBe(true)
  db.query.mockResolvedValue({ rows: [] })
  expect(await requeueFailedDecisionNotification(db.client, eventId, actor)).toBe(false)
})
it.each(['safe', 'missing', 'rolsuper', 'rolbypassrls', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolinherit', 'memberships', 'passwords', 'receipts', 'can_decide', 'schema_create', 'database_create', 'owned', 'unsafe_definer', 'role', 'login'])('checks the worker least-privilege boundary: %s', async violation => {
  const role = { role: 'expense_notifications', login: 'expense_notifications', ...(violation !== 'safe' ? { [violation]: true } : {}) }
  const db = database(() => ({ rows: violation === 'missing' ? [] : [role] }))
  if (violation === 'safe') await expect(assertNotificationWorker(db.pool)).resolves.toBeUndefined()
  else await expect(assertNotificationWorker(db.pool)).rejects.toThrow('separately provisioned')
})
describe('assignment discovery', () => {
  it.each([0, 101, 1.5])('refuses invalid batch %s', async limit => {
    const db = database(() => ({ rows: [] }))
    await expect(scanAssignments(db.pool, limit)).rejects.toThrow('Invalid assignment batch')
    expect(db.connect).not.toHaveBeenCalled()
  })
  it.each(['new', 'same', 'none', 'locked'])('handles %s assignment routing', async state => {
    const signature = JSON.stringify([actor.companyId, ['manager'], null])
    const db = database(sql => {
      if (sql.includes('SELECT en.id,en.user_id')) return { rows: [{ id: 'expense', user_id: actor.id, company_id: actor.companyId, role: 'employee', manager_id: 'manager' }] }
      if (sql.startsWith('SELECT generation')) return { rows: state === 'locked' ? [] : [{ generation: 1, signature: state === 'same' ? signature : '' }] }
      if (sql.startsWith('SELECT candidate.id')) return { rows: state === 'none' ? [] : [{ id: 'manager' }] }
      return { rows: [] }
    })
    expect(await scanAssignments(db.pool)).toEqual({ routed: state === 'new' ? 1 : 0, pendingPolicy: state === 'none' ? 1 : 0 })
    expect(db.release).toHaveBeenCalledOnce()
  })
  it.each([false, true])('bounds scan failures and releases connections (%s)', async broken => {
    const db = database(sql => { if (sql.startsWith('SELECT en.id') || (broken && sql === 'ROLLBACK')) throw new Error('private'); return { rows: [] } })
    await expect(scanAssignments(db.pool)).rejects.toThrow('Assignment scan unavailable.')
    expect(db.release).toHaveBeenCalledTimes(1)
  })
  it('stops when the scan time budget is exceeded', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(10001)
    const db = database(sql => ({ rows: sql.includes('SELECT en.id') ? [{ id: 'expense' }] : [] }))
    expect(await scanAssignments(db.pool)).toEqual({ routed: 0, pendingPolicy: 0 })
  })
})
