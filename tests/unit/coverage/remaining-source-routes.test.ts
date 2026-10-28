import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn(), connect: vi.fn(), release: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: mocks.auth }))
vi.mock('pg', () => ({ Pool: class { query = mocks.query; connect = mocks.connect }, types: { setTypeParser: vi.fn() } }))
import { GET as users } from '@/app/api/hr/users/route'
import { PUT as access } from '@/app/api/hr/users/[id]/access/route'
import { GET as status } from '@/app/api/expense-notes/[id]/validation-status/route'
import { GET as history } from '@/app/api/expense-notes/[id]/history/route'
import { GET as expenses } from '@/app/api/hr/expense-notes/route'
import { POST as hrApprove } from '@/app/api/hr/expense-notes/[id]/approve/route'
import { POST as hrReject } from '@/app/api/hr/expense-notes/[id]/reject/route'
import { POST as managerApprove } from '@/app/api/manager/expense-notes/[id]/approve/route'
import { POST as managerReject } from '@/app/api/manager/expense-notes/[id]/reject/route'
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', companyId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
let role = 'hr_admin'
let handler: (sql: string, values: unknown[]) => { rows: unknown[] }
const request = (search = '', body?: string) => new Request(`http://localhost/api/test${search}`, { method: body === undefined ? 'GET' : 'PUT', ...(body === undefined ? {} : { body }) })
const params = (value = id) => ({ params: Promise.resolve({ id: value }) })
beforeEach(() => {
  vi.clearAllMocks(); globalThis.__pgPool = undefined; vi.stubEnv('DATABASE_URL', 'postgres://synthetic')
  role = 'hr_admin'; handler = () => ({ rows: [] })
  mocks.auth.mockResolvedValue({ user: { id: actorId } })
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release })
  mocks.query.mockImplementation(async (sql: string, values: unknown[] = []) => sql.startsWith('SELECT id, company_id, role') ? { rows: [{ id: actorId, company_id: companyId, is_active: true, role }] } : handler(sql, values))
  for (const level of ['info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); globalThis.__pgPool = undefined })

it.each([false, true])('returns a directory page, optionally resolving a previous manager: %s', async filtered => {
  const oldManager = { id, name: 'Ancien manager', isEligible: false, isActive: false, role: 'employee' }
  handler = sql => ({ rows: sql.startsWith('WITH filtered') ? [{ items: [{ id, name: 'Marie', email: 'm@example.test', role: 'manager', manager_id: null }], total_count: '21', selected_manager: oldManager }] : [] })
  const response = await users(request(filtered ? `?q=Marie%25&role=manager&selectedManagerId=${id}&page=2` : ''))
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store')
  const body = await response.json()
  expect(body.items).toEqual([{ id, name: 'Marie', email: 'm@example.test', role: 'manager', managerId: null }])
  expect(body.pagination).toEqual({ page: filtered ? 2 : 1, pageSize: 20, totalItems: 21 })
  if (filtered) {
    expect(body.selectedManager).toEqual(oldManager)
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("AND role = 'manager' AND is_active"), [companyId, '%Marie\\%%', id, 20, 20])
  } else expect(body).not.toHaveProperty('selectedManager')
})
it('maps HR expenses and keeps the filtered total independent of the current page', async () => {
  handler = sql => ({ rows: sql.startsWith('WITH filtered') ? [{ items: [{ id, user_id: actorId, amount: '18.75', expense_date: '2026-10-20', description: 'Taxi', status: 'pending', receipt_key: 'receipt', created_at: '2026-10-20T10:00:00Z', author_name: '' }], total_count: '31', total_cents: '99999' }] : [] })
  const response = await expenses(request('?page=2&sort=amount%20DESC'))
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ items: [{ id, amount: 18.75, author: { id: actorId, displayName: 'User' } }], totals: { count: 31, amount: 999.99, scope: 'filtered' } })
})
it.each([
  ['approved', 'employee', true, 1, 'none', 'already_decided'],
  ['pending', 'employee', true, 1, 'manager', 'direct_manager'],
  ['pending', 'employee', false, 1, 'hr', 'hr_recourse'],
  ['pending', 'hr_admin', true, 1, 'hr', 'peer_hr'],
  ['pending', 'hr_admin', false, 0, 'none', 'no_other_active_hr'],
  ['pending', 'employee', false, 0, 'none', 'routing_policy_pending'],
])('explains routing for %s / %s / manager %s / HR %s', async (state, ownerRole, manager, hrCount, kind, reasonCode) => {
  handler = sql => ({ rows: sql.includes('SELECT en.status') ? [{ status: state, role: ownerRole, has_manager: manager, hr_count: hrCount }] : [] })
  const response = await status(request(), params())
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ status: state, validation: { kind, reasonCode, message: expect.any(String) } })
  expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('u.company_id=$3'), [id, actorId, companyId])
})
it('does not reveal a missing or invisible expense status', async () => {
  expect((await status(request(), params())).status).toBe(404)
})
it('returns dated decisions only after checking expense visibility', async () => {
  handler = sql => ({ rows: sql.includes('SELECT en.id') ? [{ id }] : sql.includes('FROM expense_decision_history') ? [{ id: 'event', from_status: 'pending', to_status: 'approved', decided_at: new Date('2026-10-20T10:00:00Z'), actor_id: actorId, actor_display_name: 'Marie' }] : [] })
  expect(await (await history(request(), params())).json()).toEqual({ items: [{ id: 'event', fromStatus: 'pending', toStatus: 'approved', decidedAt: '2026-10-20T10:00:00.000Z', actor: { id: actorId, displayName: 'Marie' } }] })
  mocks.query.mockClear(); handler = () => ({ rows: [] })
  expect((await history(request(), params())).status).toBe(404)
  expect(mocks.query.mock.calls.some(([sql]) => sql.includes('FROM expense_decision_history'))).toBe(false)
})
it.each(['{}', '{"extra":1}', '{"role":"owner"}', '{"isActive":"yes"}', 'null', '{'])('rejects invalid access changes %s before an update', async body => {
  expect((await access(request('', body), params())).status).toBe(400)
  expect(mocks.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false)
})
it.each([{ role: 'manager' }, { isActive: false }, { role: 'hr_admin', isActive: true }])('applies only explicit valid access changes %j', async change => {
  handler = (sql, values) => ({ rows: sql.includes('FOR UPDATE NOWAIT') ? [{ id, role: 'employee', is_active: true, manager_id: null }] : sql.startsWith('UPDATE users') ? [{ id, role: values[0], is_active: values[1], manager_id: values[2] }] : [] })
  const response = await access(request('', JSON.stringify(change)), params())
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ id, role: change.role ?? 'employee', isActive: change.isActive ?? true, managerId: null })
})
it('requires current HR authority before invalid input is disclosed', async () => {
  role = 'employee'
  expect((await access(request('', '{}'), params())).status).toBe(403)
  role = 'hr_admin'
  expect((await access(request('', '{"isActive":true}'), params('invalid'))).status).toBe(400)
})
it.each([['hr_admin', 'approved', hrApprove], ['hr_admin', 'rejected', hrReject], ['manager', 'approved', managerApprove], ['manager', 'rejected', managerReject]] as const)('commits %s %s decisions with their audit and notification intent', async (actorRole, decision, route) => {
  role = actorRole
  handler = sql => ({ rows: sql.startsWith('SELECT en.id') ? [{ id, user_id: 'owner', status: 'pending' }]
    : sql.startsWith('UPDATE expense_notes') ? [{ id, user_id: 'owner', amount: '18.75', expense_date: '2026-10-20', description: 'Taxi', receipt_key: 'receipt', status: decision, created_at: '2026-10-20T10:00:00Z' }]
    : sql.startsWith('INSERT INTO expense_decision_history') ? [{ id: 'event', decided_at: new Date('2026-10-20T12:00:00Z') }]
    : sql.includes('SELECT 1 FROM public.decision_notification_outbox') ? [{ value: 1 }] : [] })
  const response = await route(request(), params())
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ id, status: decision })
  expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO public.decision_notification_outbox'), ['event', id, 'owner', companyId, decision])
  expect(mocks.query).toHaveBeenCalledWith('COMMIT')
  expect(mocks.query).not.toHaveBeenCalledWith('ROLLBACK')
})
it('uses owner-only history visibility for employees', async () => {
  role = 'employee'
  expect((await history(request(), params())).status).toBe(404)
  expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('OR (FALSE)'), [id, actorId, companyId])
})
