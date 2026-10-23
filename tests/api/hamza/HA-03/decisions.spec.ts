import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'

const baseURL = process.env.HA03_TEST_BASE_URL
const databaseURL = process.env.HA03_TEST_DATABASE_URL
const password = process.env.HA03_TEST_PASSWORD
if (!baseURL || !databaseURL || !password) throw new Error('Set HA03_TEST_BASE_URL, HA03_TEST_DATABASE_URL and HA03_TEST_PASSWORD for an isolated test environment.')
const database = new URL(databaseURL)
if (!['localhost', '127.0.0.1'].includes(database.hostname) || !database.pathname.endsWith('_test')) throw new Error('HA-03 fixtures require a local _test database.')
if (!['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname)) throw new Error('HA-03 HTTP tests require a local test server.')

const pool = new Pool({ connectionString: databaseURL })
const companies = { a: randomUUID(), b: randomUUID() }
const ids = Object.fromEntries(['hrA', 'managerA', 'employeeA', 'unrelatedA', 'hrB', 'managerB', 'employeeB', 'corruptB', 'hrPeerA'].map((name) => [name, randomUUID()]))
const contexts: Record<string, APIRequestContext> = {}
const notes: string[] = []

async function note(owner: string, description = 'HA03 test expense') {
  const id = randomUUID()
  notes.push(id)
  await pool.query(`INSERT INTO expense_notes (id,user_id,amount,expense_date,description,receipt_key)
    VALUES ($1,$2,42.50,'2026-10-21',$3,'ha03-test/receipt.png')`, [id, ids[owner], description])
  return id
}
async function history(id: string) { return (await pool.query('SELECT * FROM expense_decision_history WHERE expense_note_id=$1 ORDER BY decided_at,id', [id])).rows }
async function status(id: string) { return (await pool.query('SELECT status FROM expense_notes WHERE id=$1', [id])).rows[0].status }
async function problem(response: APIResponse, expected: number) {
  expect(response.status()).toBe(expected)
  const body = await response.json()
  expect(body.status).toBe(expected)
  expect(body.error).toBe(body.detail)
  expect(body.requestId).toBe(response.headers()['x-request-id'])
  expect(JSON.stringify(body)).not.toContain(password)
  expect(JSON.stringify(body)).not.toContain('ha03-test/')
  expect(body).not.toHaveProperty('stack')
  return body
}

test.beforeAll(async ({ playwright }) => {
  const hash = await bcrypt.hash(password!, 4)
  for (const [name, companyId] of Object.entries(companies)) await pool.query('INSERT INTO companies (id,name,email_domain) VALUES ($1,$2,$3)', [companyId, `HA03 ${name}`, `${companyId}.test`])
  for (const [name, id] of Object.entries(ids)) {
    const companyId = name.endsWith('B') ? companies.b : companies.a
    const role = name.startsWith('hr') ? 'hr_admin' : name.startsWith('manager') ? 'manager' : 'employee'
    const managerId = name === 'employeeA' || name === 'corruptB' ? ids.managerA : name === 'employeeB' ? ids.managerB : null
    await pool.query('INSERT INTO users (id,company_id,name,email,password_hash,role,manager_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, companyId, `HA03 ${name}`, `${id}@example.test`, hash, role, managerId])
  }
  for (const name of Object.keys(ids)) {
    const context = await playwright.request.newContext({ baseURL })
    contexts[name] = context
    const csrf = await (await context.get('/api/auth/csrf')).json()
    const response = await context.post('/api/auth/callback/credentials', { form: { csrfToken: csrf.csrfToken, email: `${ids[name]}@example.test`, password: password!, callbackUrl: `${baseURL}/expenses` }, maxRedirects: 0 })
    expect(response.status()).toBe(302)
    expect((await (await context.get('/api/auth/session')).json()).user.id).toBe(ids[name])
  }
})

test.afterAll(async () => {
  await Promise.all(Object.values(contexts).map((context) => context.dispose()))
  await pool.query('DELETE FROM expense_notes WHERE id = ANY($1::uuid[])', [notes])
  await pool.query('UPDATE users SET manager_id=NULL WHERE id = ANY($1::uuid[])', [Object.values(ids)])
  await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [Object.values(ids)])
  await pool.query('DELETE FROM companies WHERE id = ANY($1::uuid[])', [Object.values(companies)])
  await pool.end()
})

for (const [caller, route, owner] of [['managerA', 'manager', 'employeeA'], ['hrA', 'hr', 'managerA']]) {
  for (const [action, decision] of [['approve', 'approved'], ['reject', 'rejected']]) {
    test(`${route}/${action} uses the shared mapper and appends exactly one event`, async () => {
      const id = await note(owner)
      const response = await contexts[caller].post(`/api/${route}/expense-notes/${id}/${action}`)
      expect(response.status()).toBe(200)
      expect(await response.json()).toEqual({ id, userId: ids[owner], amount: 42.5, expenseDate: '2026-10-21', description: 'HA03 test expense', receiptKey: 'ha03-test/receipt.png', status: decision, createdAt: expect.any(String) })
      const events = await history(id)
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ actor_id: ids[caller], from_status: 'pending', to_status: decision, actor_display_name: `HA03 ${caller}` })
      expect(events[0].id).toMatch(/^[0-9a-f-]{36}$/)
      expect(events[0].decided_at).toBeInstanceOf(Date)
    })
  }
}

test('overlapping PostgreSQL approve/reject: one winner, one conflict, one history event', async () => {
  const id = await note('employeeA')
  const writer = await pool.connect()
  let pending: Promise<APIResponse>[] = []
  try {
    await writer.query('BEGIN')
    await writer.query('SELECT id FROM expense_notes WHERE id=$1 FOR UPDATE', [id])
    pending = [contexts.managerA.post(`/api/manager/expense-notes/${id}/approve`), contexts.managerA.post(`/api/manager/expense-notes/${id}/reject`)]
    // Both requests must reach their conditional UPDATE before the row lock is released.
    await expect.poll(async () => Number((await pool.query("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'UPDATE expense_notes en%'" )).rows[0].count)).toBe(2)
    await writer.query('COMMIT')
    const responses = await Promise.all(pending)
    expect(responses.map((response) => response.status()).sort()).toEqual([200, 409])
    const winner = await responses.find((response) => response.status() === 200)!.json()
    await problem(responses.find((response) => response.status() === 409)!, 409)
    expect(await status(id)).toBe(winner.status)
    const events = await history(id)
    expect(events).toHaveLength(1)
    expect(events[0].to_status).toBe(winner.status)
    const action = winner.status === 'approved' ? 'approve' : 'reject'
    await problem(await contexts.managerA.post(`/api/manager/expense-notes/${id}/${action}`), 409)
    expect(await history(id)).toHaveLength(1)
  } finally {
    await writer.query('ROLLBACK')
    await Promise.allSettled(pending)
    writer.release()
  }
})

test('foreign, unrelated and historical cross-company notes remain hidden without writes', async () => {
  for (const owner of ['employeeB', 'unrelatedA', 'corruptB']) {
    const id = await note(owner)
    for (const action of ['approve', 'reject']) await problem(await contexts.managerA.post(`/api/manager/expense-notes/${id}/${action}`), 404)
    await problem(await contexts.managerA.get(`/api/expense-notes/${id}/history`), 404)
    expect(await status(id)).toBe('pending')
    expect(await history(id)).toHaveLength(0)
  }
  const foreignManager = await note('managerB')
  await problem(await contexts.hrA.post(`/api/hr/expense-notes/${foreignManager}/approve`), 404)
  await problem(await contexts.hrA.get(`/api/expense-notes/${foreignManager}/history`), 404)
})

test('history insert failure rolls back status and leaves no partial event', async () => {
  const id = await note('employeeA')
  // Only this run's UUID is rejected, on this guarded disposable database.
  await pool.query(`ALTER TABLE expense_decision_history ADD CONSTRAINT ha03_test_history_failure CHECK (expense_note_id <> '${id}'::uuid)`)
  try {
    await problem(await contexts.managerA.post(`/api/manager/expense-notes/${id}/approve`), 500)
    expect(await status(id)).toBe('pending')
    expect(await history(id)).toHaveLength(0)
    expect(await (await contexts.employeeA.get(`/api/expense-notes/${id}/history`)).json()).toEqual({ items: [] })
  } finally { await pool.query('ALTER TABLE expense_decision_history DROP CONSTRAINT ha03_test_history_failure') }
})

test('owner and current manager can read real history after decision; other roles stay scoped', async () => {
  const id = await note('employeeA')
  expect((await contexts.managerA.post(`/api/manager/expense-notes/${id}/approve`)).status()).toBe(200)
  const recorded = (await history(id))[0]
  for (const caller of ['employeeA', 'managerA']) {
    const response = await contexts[caller].get(`/api/expense-notes/${id}/history`)
    expect(response.status()).toBe(200)
    expect(await response.json()).toEqual({ items: [{ id: recorded.id, fromStatus: 'pending', toStatus: 'approved', decidedAt: recorded.decided_at.toISOString(), actor: { id: ids.managerA, displayName: 'HA03 managerA' } }] })
    expect(JSON.stringify(await response.json())).not.toContain('@example.test')
    expect(JSON.stringify(await response.json())).not.toContain('receipt')
  }
  for (const caller of ['hrA', 'unrelatedA', 'employeeB', 'managerB', 'hrB']) await problem(await contexts[caller].get(`/api/expense-notes/${id}/history`), 404)
})

test('HR and a root-manager owner can read their real decision history after decision', async () => {
  const id = await note('managerA')
  expect((await contexts.hrA.post(`/api/hr/expense-notes/${id}/reject`)).status()).toBe(200)
  for (const caller of ['hrA', 'managerA']) {
    const response = await contexts[caller].get(`/api/expense-notes/${id}/history`)
    expect(response.status()).toBe(200)
    expect((await response.json()).items[0]).toMatchObject({ fromStatus: 'pending', toStatus: 'rejected', actor: { id: ids.hrA, displayName: 'HA03 hrA' } })
  }
  await problem(await contexts.hrB.get(`/api/expense-notes/${id}/history`), 404)
})

test('history honors the current relation and role, while retaining the actor name snapshot', async () => {
  const id = await note('employeeA')
  expect((await contexts.managerA.post(`/api/manager/expense-notes/${id}/approve`)).status()).toBe(200)
  try {
    await pool.query('UPDATE users SET manager_id=NULL WHERE id=$1', [ids.employeeA])
    await problem(await contexts.managerA.get(`/api/expense-notes/${id}/history`), 404)
    await pool.query("UPDATE users SET name='Renamed', role='employee' WHERE id=$1", [ids.managerA])
    const ownerHistory = await (await contexts.employeeA.get(`/api/expense-notes/${id}/history`)).json()
    expect(ownerHistory.items[0].actor.displayName).toBe('HA03 managerA')
    await problem(await contexts.managerA.post(`/api/manager/expense-notes/${id}/approve`), 403)
  } finally {
    await pool.query("UPDATE users SET name='HA03 managerA', role='manager' WHERE id=$1", [ids.managerA])
    await pool.query('UPDATE users SET manager_id=$1 WHERE id=$2', [ids.managerA, ids.employeeA])
  }
})

test('a company change cannot expose a prior-company history event', async () => {
  const id = await note('employeeA')
  expect((await contexts.managerA.post(`/api/manager/expense-notes/${id}/approve`)).status()).toBe(200)
  try {
    await pool.query('UPDATE users SET company_id=$1 WHERE id=$2', [companies.b, ids.employeeA])
    const response = await contexts.employeeA.get(`/api/expense-notes/${id}/history`)
    expect(response.status()).toBe(200)
    expect(await response.json()).toEqual({ items: [] })
    expect((await history(id))[0].company_id).toBe(companies.a)
  } finally { await pool.query('UPDATE users SET company_id=$1 WHERE id=$2', [companies.a, ids.employeeA]) }
})

test('history distinguishes unauthenticated requests without exposing resource existence', async ({ request }) => {
  await problem(await request.get(`${baseURL}/api/expense-notes/${randomUUID()}/history`), 401)
})

test('PO-01: peer HR decision creates real history while self and foreign HR stay denied', async () => {
  const id = await note('hrA')
  await problem(await contexts.hrA.post(`/api/hr/expense-notes/${id}/approve`), 404)
  await problem(await contexts.hrB.post(`/api/hr/expense-notes/${id}/approve`), 404)
  expect(await history(id)).toHaveLength(0)
  expect((await contexts.hrPeerA.post(`/api/hr/expense-notes/${id}/approve`)).status()).toBe(200)
  const response = await contexts.hrA.get(`/api/expense-notes/${id}/history`)
  expect(response.status()).toBe(200)
  expect((await response.json()).items).toEqual([expect.objectContaining({
    toStatus: 'approved', actor: { id: ids.hrPeerA, displayName: 'HA03 hrPeerA' },
  })])
  await problem(await contexts.hrB.get(`/api/expense-notes/${id}/history`), 404)
})

test('PO-01: inactive author notes remain decidable by HR when the direct manager is unavailable', async () => {
  const id = await note('employeeA')
  try {
    await pool.query('UPDATE users SET is_active=false WHERE id=ANY($1::uuid[])', [[ids.employeeA, ids.managerA]])
    expect((await contexts.hrA.post(`/api/hr/expense-notes/${id}/reject`)).status()).toBe(200)
    expect(await status(id)).toBe('rejected')
    expect(await history(id)).toEqual([expect.objectContaining({ actor_id: ids.hrA, to_status: 'rejected' })])
    const response = await contexts.hrA.get(`/api/expense-notes/${id}/history`)
    expect(response.status()).toBe(200)
    expect((await response.json()).items).toHaveLength(1)
  } finally { await pool.query('UPDATE users SET is_active=true WHERE id=ANY($1::uuid[])', [[ids.employeeA, ids.managerA]]) }
})

test('PO-01: a historical self-manager link stays denied for self and allows HR recourse', async () => {
  const id = await note('managerA')
  try {
    await pool.query('UPDATE users SET manager_id=id WHERE id=$1', [ids.managerA])
    await problem(await contexts.managerA.post(`/api/manager/expense-notes/${id}/approve`), 404)
    expect((await contexts.hrA.post(`/api/hr/expense-notes/${id}/approve`)).status()).toBe(200)
    expect(await history(id)).toHaveLength(1)
  } finally { await pool.query('UPDATE users SET manager_id=NULL WHERE id=$1', [ids.managerA]) }
})
