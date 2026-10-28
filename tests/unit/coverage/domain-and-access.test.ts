import { expect, it } from 'vitest'
import { ExpenseNote } from '@/domain/ExpenseNote'
import { User } from '@/domain/User'
import { formatCurrency, formatDate, truncate } from '@/utils/format'
import { isNonEmptyString, isPositiveAmount, isValidEmail } from '@/utils/validators'
import { changeUserAccess } from '@/lib/change-user-access'
import { actor, database } from './database-helper'
const props = { id: 'note', userId: 'user', amount: 10, expenseDate: '2026-10-20', description: 'Taxi', receiptKey: 'receipt', status: 'pending' as const }
it('makes immutable expense decisions and prevents repeated transitions', () => {
  const note = new ExpenseNote(props), approved = note.approve(), rejected = note.reject()
  expect(note.id).toBe('note'); expect(note.canBeDecided()).toBe(true); expect(note.status).toBe('pending')
  expect(approved.toJSON()).toEqual({ ...props, status: 'approved' }); expect(rejected.status).toBe('rejected')
  expect(() => approved.reject()).toThrow('déjà été tranchée'); expect(() => rejected.approve()).toThrow('déjà été tranchée')
  approved.toJSON().description = 'changed'; expect(approved.toJSON().description).toBe('Taxi')
})
it('defines manager capabilities from the actual reporting relation', () => {
  const props = { id: 'manager', email: 'm@example.test', name: 'Marie', role: 'manager' as const, managerId: null }
  const manager = new User(props), employee = new User({ ...props, id: 'employee', role: 'employee', managerId: 'manager' })
  expect(manager.id).toBe('manager'); expect(manager.role).toBe('manager'); expect(manager.isRootManager()).toBe(true)
  expect(employee.isRootManager()).toBe(false); expect(manager.canManage(employee)).toBe(true); expect(employee.canManage(manager)).toBe(false); expect(manager.canManage(manager)).toBe(false)
})
it('formats amounts, dates and bounded labels', () => {
  expect(formatCurrency(12.5)).toContain('12,50'); expect(formatCurrency(12.5, 'USD')).toContain('$')
  expect(formatDate('2026-10-20T12:00:00Z')).toBe(formatDate(new Date('2026-10-20T12:00:00Z')))
  expect(truncate('short')).toBe('short'); expect(truncate('longer label', 5)).toBe('long…')
  expect(isValidEmail('a@example.test')).toBe(true); expect(isValidEmail('invalid')).toBe(false)
  expect(isPositiveAmount(0)).toBe(false); expect(isPositiveAmount(Infinity)).toBe(false); expect(isPositiveAmount(1)).toBe(true)
  expect(isNonEmptyString(' x ')).toBe(true); expect(isNonEmptyString(' ')).toBe(false); expect(isNonEmptyString(null)).toBe(false)
})
it.each(['ok', 'forbidden', 'missing', 'busy', 'last-hr', 'removed', 'database'])('handles access change %s with current rights and audit', async fault => {
  const db = database((sql, values) => {
    if (sql.includes('FOR UPDATE NOWAIT')) { if (fault === 'busy' || fault === 'database') throw { code: fault === 'busy' ? '55P03' : 'XX000' }; return { rows: fault === 'missing' ? [] : [{ id: 'target', role: 'hr_admin', is_active: true, manager_id: null }] } }
    if (sql.includes('count(*)')) return { rows: [{ count: fault === 'last-hr' ? 1 : 2 }] }
    if (sql.startsWith('UPDATE users')) return { rows: fault === 'removed' ? [] : [{ id: 'target', role: values[0], is_active: values[1], manager_id: values[2] }] }
    return { rows: [] }
  })
  const change = changeUserAccess(db.client, fault === 'forbidden' ? { ...actor, role: 'employee' } : actor, 'target', { role: 'manager', isActive: false })
  if (fault === 'ok') expect(await change).toEqual({ id: 'target', role: 'manager', is_active: false, manager_id: null })
  else await expect(change).rejects.toMatchObject({ code: { forbidden: 'forbidden', missing: 'not_found', busy: 'manager_assignment_busy', 'last-hr': 'last_active_hr', removed: 'not_found', database: 'XX000' }[fault] })
})
it('clears the reporting manager on promotion to HR and preserves unspecified fields', async () => {
  const db = database((sql, values) => ({ rows: sql.includes('FOR UPDATE') ? [{ id: 'target', role: 'employee', is_active: true, manager_id: 'old' }] : sql.startsWith('UPDATE') ? [{ id: 'target', role: values[0], is_active: values[1], manager_id: values[2] }] : [] }))
  expect(await changeUserAccess(db.client, actor, 'target', { role: 'hr_admin' })).toMatchObject({ role: 'hr_admin', is_active: true, manager_id: null })
  expect(await changeUserAccess(db.client, actor, 'target', {})).toMatchObject({ role: 'employee', manager_id: 'old' })
})
