import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'

const baseURL = process.env.HA02_TEST_BASE_URL
const databaseURL = process.env.HA02_TEST_DATABASE_URL
const password = process.env.HA02_TEST_PASSWORD
if (!baseURL || !databaseURL || !password) throw new Error('Set HA02_TEST_BASE_URL, HA02_TEST_DATABASE_URL and HA02_TEST_PASSWORD for an isolated test environment.')
const database = new URL(databaseURL)
if (!['localhost', '127.0.0.1'].includes(database.hostname) || !database.pathname.endsWith('_test')) throw new Error('HA-02 fixtures require a local _test database.')
if (!['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname)) throw new Error('HA-02 HTTP tests require a local application.')

const pool = new Pool({ connectionString: databaseURL })
const companies = { a: randomUUID(), b: randomUUID() }
const ids = Object.fromEntries(['hrA', 'managerA', 'employeeA', 'hrB', 'managerB', 'employeeB', 'unrelatedA', 'corruptB', 'deletedA', 'disabledA', 'hrPeerA', 'managerInactiveA'].map((name) => [name, randomUUID()]))
const noteIds = Object.fromEntries(['employeeA', 'employeeB', 'managerA', 'managerB', 'unrelatedA', 'corruptB', 'blankEmployeeA', 'blankManagerA', 'decisionA', 'hrA', 'hrPeerA', 'fallbackA', 'disabledA'].map((name) => [name, randomUUID()]))
const contexts: Record<string, APIRequestContext> = {}

test.beforeAll(async ({ playwright }) => {
  const hash = await bcrypt.hash(password!, 4)
  for (const [label, companyId] of Object.entries(companies)) await pool.query('INSERT INTO companies (id,name,email_domain) VALUES ($1,$2,$3)', [companyId, `HA02 ${label}`, `${companyId}.test`])
  for (const [name, id] of Object.entries(ids)) {
    const companyId = name.endsWith('B') ? companies.b : companies.a
    const role = name.startsWith('hr') ? 'hr_admin' : name.startsWith('manager') ? 'manager' : 'employee'
    const managerId = name === 'employeeA' || name === 'corruptB' ? ids.managerA : name === 'employeeB' ? ids.managerB : null
    await pool.query('INSERT INTO users (id,company_id,name,email,password_hash,role,manager_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, companyId, name, `${id}@example.test`, hash, role, managerId])
  }
  for (const [name, id] of Object.entries(noteIds)) {
    const owner = name === 'blankEmployeeA' || name === 'decisionA' || name === 'fallbackA' ? 'employeeA' : name === 'blankManagerA' ? 'managerA' : name
    await pool.query('INSERT INTO expense_notes (id,user_id,amount,expense_date,description,receipt_key,status) VALUES ($1,$2,12.50,$3,$4,$5,$6)', [id, ids[owner], '2026-10-21', `HA02 ${name}`, name.startsWith('blank') ? '  ' : `ha02/${id}.png`, 'pending'])
  }
  for (const name of ['hrA', 'managerA', 'employeeA', 'hrB', 'managerB', 'employeeB', 'deletedA', 'disabledA', 'hrPeerA']) {
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
  await pool.query('DELETE FROM expense_notes WHERE id = ANY($1::uuid[])', [Object.values(noteIds)])
  await pool.query('UPDATE users SET manager_id = NULL WHERE id = ANY($1::uuid[])', [Object.values(ids)])
  await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [Object.values(ids)])
  await pool.query('DELETE FROM companies WHERE id = ANY($1::uuid[])', [Object.values(companies)])
  await pool.end()
})

async function problem(response: APIResponse, status: number) {
  expect(response.status()).toBe(status)
  const body = await response.json()
  expect(body.status).toBe(status)
  expect(body.error).toBe(body.detail)
  expect(body.requestId).toBe(response.headers()['x-request-id'])
  expect(body).not.toHaveProperty('url')
  expect(JSON.stringify(body)).not.toContain(password)
  expect(JSON.stringify(body)).not.toContain('ha02/')
  return body
}
async function assignedManager() { return (await pool.query('SELECT manager_id FROM users WHERE id=$1', [ids.employeeA])).rows[0].manager_id }

for (const suffix of ['A', 'B']) {
  test(`company ${suffix}: employee cannot use manager/HR operations`, async () => {
    for (const path of ['/api/manager/expense-notes', '/api/hr/expense-notes', '/api/hr/users']) await problem(await contexts[`employee${suffix}`].get(path), 403)
  })
  test(`company ${suffix}: manager lists only current direct reports in its own company`, async () => {
    const response = await contexts[`manager${suffix}`].get('/api/manager/expense-notes')
    expect(response.status()).toBe(200)
    const notes = (await response.json()).items
    expect(notes.map((note: { id: string }) => note.id)).toContain(noteIds[`employee${suffix}`])
    for (const name of ['unrelatedA', 'corruptB', `employee${suffix === 'A' ? 'B' : 'A'}`]) expect(notes.map((note: { id: string }) => note.id)).not.toContain(noteIds[name])
  })
  test(`company ${suffix}: HR preserves root-manager scope and current tenant directory`, async () => {
    const context = contexts[`hr${suffix}`]
    const notes = (await (await context.get('/api/hr/expense-notes')).json()).items
    expect(notes.map((note: { id: string }) => note.id)).toContain(noteIds[`manager${suffix}`])
    expect(notes.map((note: { id: string }) => note.id)).not.toContain(noteIds[`manager${suffix === 'A' ? 'B' : 'A'}`])
    const users = (await (await context.get('/api/hr/users')).json()).items
    expect(users.map((user: { id: string }) => user.id)).toContain(ids[`employee${suffix}`])
    expect(users.map((user: { id: string }) => user.id)).not.toContain(ids[`manager${suffix === 'A' ? 'B' : 'A'}`])
  })
}

test('manager denies receipts and both decisions for foreign, historical cross-tenant and unrelated authors', async () => {
  for (const name of ['employeeB', 'corruptB', 'unrelatedA']) {
    const id = noteIds[name]
    await problem(await contexts.managerA.get(`/api/manager/expense-notes/${id}/receipt-url`), 404)
    for (const decision of ['approve', 'reject']) await problem(await contexts.managerA.post(`/api/manager/expense-notes/${id}/${decision}`), 404)
    expect((await pool.query('SELECT status FROM expense_notes WHERE id=$1', [id])).rows[0].status).toBe('pending')
  }
})

test('HR cannot read or decide another company root-manager expense', async () => {
  const id = noteIds.managerB
  await problem(await contexts.hrA.get(`/api/hr/expense-notes/${id}/receipt-url`), 404)
  for (const decision of ['approve', 'reject']) await problem(await contexts.hrA.post(`/api/hr/expense-notes/${id}/${decision}`), 404)
  expect((await pool.query('SELECT status FROM expense_notes WHERE id=$1', [id])).rows[0].status).toBe('pending')
})

test('authorized receipt paths preserve their success DTO and personal ownership', async () => {
  for (const [name, path] of [
    ['employeeA', `/api/expense-notes/${noteIds.employeeA}/receipt-url`],
    ['managerA', `/api/manager/expense-notes/${noteIds.employeeA}/receipt-url`],
    ['hrA', `/api/hr/expense-notes/${noteIds.managerA}/receipt-url`],
  ]) {
    const response = await contexts[name].get(path)
    expect(response.status()).toBe(200)
    expect(Object.keys(await response.json())).toEqual(['url'])
    expect(typeof (await response.json()).url).toBe('string')
  }
  await problem(await contexts.employeeA.get(`/api/expense-notes/${noteIds.employeeB}/receipt-url`), 404)
})

test('all three receipt paths reject blank keys', async () => {
  await problem(await contexts.employeeA.get(`/api/expense-notes/${noteIds.blankEmployeeA}/receipt-url`), 404)
  await problem(await contexts.managerA.get(`/api/manager/expense-notes/${noteIds.blankEmployeeA}/receipt-url`), 404)
  await problem(await contexts.hrA.get(`/api/hr/expense-notes/${noteIds.blankManagerA}/receipt-url`), 404)
})

test('forged tenant/role and a foreign manager cannot change membership', async () => {
  await problem(await contexts.hrA.put(`/api/hr/users/${ids.employeeA}/manager`, { data: { managerId: ids.managerB, companyId: companies.b, role: 'hr_admin' } }), 409)
  expect(await assignedManager()).toBe(ids.managerA)
  await problem(await contexts.hrA.put(`/api/hr/users/${ids.employeeB}/manager`, { data: { managerId: ids.managerA } }), 404)
  expect((await pool.query('SELECT manager_id FROM users WHERE id=$1', [ids.employeeB])).rows[0].manager_id).toBe(ids.managerB)
})

test('explicit null and a valid same-company manager preserve the existing assignment contract', async () => {
  try {
    const cleared = await contexts.hrA.put(`/api/hr/users/${ids.employeeA}/manager`, { data: { managerId: null } })
    expect(cleared.status()).toBe(200)
    expect((await cleared.json()).managerId).toBeNull()
    const assigned = await contexts.hrA.put(`/api/hr/users/${ids.employeeA}/manager`, { data: { managerId: ids.managerA } })
    expect(assigned.status()).toBe(200)
    expect(await assigned.json()).toMatchObject({ id: ids.employeeA, role: 'employee', managerId: ids.managerA })
  } finally { await pool.query('UPDATE users SET manager_id=$1 WHERE id=$2', [ids.managerA, ids.employeeA]) }
})

test('assignment refuses a busy manager and rechecks their role on retry', async () => {
  const writer = await pool.connect()
  let pending: Promise<APIResponse> | undefined
  try {
    await writer.query('BEGIN')
    await writer.query("UPDATE users SET role='employee' WHERE id=$1", [ids.managerA])
    pending = contexts.hrA.put(`/api/hr/users/${ids.employeeA}/manager`, { data: { managerId: ids.managerA } })
    expect((await problem(await pending, 409)).type).toBe('urn:expense-io:problem:manager_assignment_busy')
    await writer.query('COMMIT')
    const retry = await contexts.hrA.put(`/api/hr/users/${ids.employeeA}/manager`, { data: { managerId: ids.managerA } })
    expect((await problem(retry, 409)).type).toBe('urn:expense-io:problem:invalid_manager')
    expect(await assignedManager()).toBe(ids.managerA)
  } finally {
    await writer.query('ROLLBACK')
    await pending?.catch(() => {})
    await pool.query("UPDATE users SET role='manager' WHERE id=$1", [ids.managerA])
    writer.release()
  }
})

test('receipt and decision recheck the management relation after a concurrent reassignment', async () => {
  const writer = await pool.connect()
  let pending: Promise<APIResponse>[] = []
  try {
    await writer.query('BEGIN')
    await writer.query('UPDATE users SET manager_id=NULL WHERE id=$1', [ids.employeeA])
    pending = [
      contexts.managerA.get(`/api/manager/expense-notes/${noteIds.employeeA}/receipt-url`),
      contexts.managerA.post(`/api/manager/expense-notes/${noteIds.employeeA}/approve`),
    ]
    await expect.poll(async () => Number((await pool.query("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT en.%FROM expense_notes en%'" )).rows[0].count)).toBe(2)
    await writer.query('COMMIT')
    for (const response of await Promise.all(pending)) await problem(response, 404)
    expect((await pool.query('SELECT status FROM expense_notes WHERE id=$1', [noteIds.employeeA])).rows[0].status).toBe('pending')
  } finally {
    await writer.query('ROLLBACK')
    await Promise.allSettled(pending)
    await pool.query('UPDATE users SET manager_id=$1 WHERE id=$2', [ids.managerA, ids.employeeA])
    writer.release()
  }
})

test('an existing signed session loses privileged access on the next request after a role change', async () => {
  try {
    await pool.query("UPDATE users SET role='employee' WHERE id=$1", [ids.managerA])
    // Session reads and operation authorization both observe current rights.
    expect((await (await contexts.managerA.get('/api/auth/session')).json()).user.role).toBe('employee')
    await problem(await contexts.managerA.get('/api/manager/expense-notes'), 403)
    await problem(await contexts.managerA.get(`/api/manager/expense-notes/${noteIds.employeeA}/receipt-url`), 403)
  } finally { await pool.query("UPDATE users SET role='manager' WHERE id=$1", [ids.managerA]) }
})

test('a deleted user cannot continue through their retained session', async () => {
  await pool.query('DELETE FROM users WHERE id=$1', [ids.deletedA])
  await problem(await contexts.deletedA.get(`/api/expense-notes/${noteIds.employeeA}/receipt-url`), 401)
})

test('an authorized manager decision preserves the expense representation', async () => {
  const response = await contexts.managerA.post(`/api/manager/expense-notes/${noteIds.decisionA}/approve`)
  expect(response.status()).toBe(200)
  expect(await response.json()).toMatchObject({ id: noteIds.decisionA, userId: ids.employeeA, amount: 12.5, expenseDate: '2026-10-21', status: 'approved' })
  await problem(await contexts.managerA.post(`/api/manager/expense-notes/${noteIds.decisionA}/approve`), 409)
})

test('PO-01: only a peer HR can decide an HR expense, never its own author', async () => {
  const list = (await (await contexts.hrA.get('/api/hr/expense-notes')).json()).items
  expect(list.map((note: { id: string }) => note.id)).toContain(noteIds.hrPeerA)
  expect(list.map((note: { id: string }) => note.id)).not.toContain(noteIds.hrA)
  await problem(await contexts.hrA.post(`/api/hr/expense-notes/${noteIds.hrA}/approve`), 404)
  await problem(await contexts.managerA.post(`/api/manager/expense-notes/${noteIds.hrA}/approve`), 404)
  expect((await contexts.hrPeerA.post(`/api/hr/expense-notes/${noteIds.hrA}/approve`)).status()).toBe(200)
})

test('PO-01: an inactive direct manager gives HR recourse without hiding the authors notes', async () => {
  try {
    await pool.query('UPDATE users SET is_active=false WHERE id=$1', [ids.managerA])
    const notes = (await (await contexts.hrA.get('/api/hr/expense-notes')).json()).items
    expect(notes.map((note: { id: string }) => note.id)).toContain(noteIds.fallbackA)
    expect((await contexts.hrA.post(`/api/hr/expense-notes/${noteIds.fallbackA}/reject`)).status()).toBe(200)
  } finally { await pool.query('UPDATE users SET is_active=true WHERE id=$1', [ids.managerA]) }
})

test('PO-01: disabled accounts lose retained sessions and cannot log in again; their notes survive', async () => {
  await pool.query('UPDATE users SET is_active=false WHERE id=$1', [ids.disabledA])
  expect(await (await contexts.disabledA.get('/api/auth/session')).json()).toBeNull()
  expect((await contexts.disabledA.get('/api/expense-notes')).status()).toBe(401)
  expect((await pool.query('SELECT status FROM expense_notes WHERE id=$1', [noteIds.disabledA])).rows[0].status).toBe('pending')
  const csrf = await (await contexts.disabledA.get('/api/auth/csrf')).json()
  const login = await contexts.disabledA.post('/api/auth/callback/credentials', {
    form: { csrfToken: csrf.csrfToken, email: `${ids.disabledA}@example.test`, password: password!, callbackUrl: `${baseURL}/expenses` }, maxRedirects: 0,
  })
  expect(login.status()).toBe(302)
  expect(login.headers().location).toContain('error=CredentialsSignin')
  const notes = (await (await contexts.hrA.get('/api/hr/expense-notes')).json()).items
  expect(notes.map((note: { id: string }) => note.id)).toContain(noteIds.disabledA)
})

test('PO-01: a pathological historical self-manager relation cannot authorize self-approval', async () => {
  try {
    await pool.query('UPDATE users SET manager_id=id WHERE id=$1', [ids.managerA])
    await problem(await contexts.managerA.post(`/api/manager/expense-notes/${noteIds.managerA}/approve`), 404)
  } finally { await pool.query('UPDATE users SET manager_id=NULL WHERE id=$1', [ids.managerA]) }
})

test('PO-01: HR cannot select an inactive manager for a new assignment', async () => {
  await pool.query('UPDATE users SET is_active=false WHERE id=$1', [ids.managerInactiveA])
  const response = await contexts.hrA.put(`/api/hr/users/${ids.employeeA}/manager`, { data: { managerId: ids.managerInactiveA } })
  expect((await problem(response, 409)).type).toBe('urn:expense-io:problem:invalid_manager')
  expect(await assignedManager()).toBe(ids.managerA)
})

test('activation migration preserves existing accounts and supports its rollback', async () => {
  const schema = `ha02_${randomUUID().replaceAll('-', '')}`
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema}; CREATE TABLE users (id int PRIMARY KEY); INSERT INTO users VALUES (1)`)
    const [up, down] = readFileSync('migrations/1792583999000_hamza_current-account.sql', 'utf8').split('-- Down Migration')
    await client.query(up)
    expect((await client.query('SELECT id, is_active FROM users')).rows).toEqual([{ id: 1, is_active: true }])
    await client.query(down)
    expect((await client.query('SELECT * FROM users')).rows).toEqual([{ id: 1 }])
  } finally { await client.query('ROLLBACK'); client.release() }
})
