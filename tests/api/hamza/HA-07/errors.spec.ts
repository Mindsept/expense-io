import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'

// Never silently target a personal demo. Validation is allowed only on an explicitly designated local _test DB.
const baseURL = process.env.HA07_TEST_BASE_URL
const databaseURL = process.env.HA07_TEST_DATABASE_URL
const password = process.env.HA07_TEST_PASSWORD
if (!baseURL || !databaseURL || !password) throw new Error('Set HA07_TEST_BASE_URL, HA07_TEST_DATABASE_URL and HA07_TEST_PASSWORD for an isolated test environment.')
const database = new URL(databaseURL)
if (!['localhost', '127.0.0.1'].includes(database.hostname) || !database.pathname.endsWith('_test')) {
  throw new Error('HA-07 fixtures require a local database with a _test suffix.')
}
const application = new URL(baseURL)
if (!['localhost', '127.0.0.1'].includes(application.hostname)) throw new Error('HA-07 API tests require an isolated local application.')

const pool = new Pool({ connectionString: databaseURL })
const companyId = randomUUID()
const hrId = randomUUID()
const managerId = randomUUID()
const employeeId = randomUUID()
const pendingId = randomUUID()
const decidedId = randomUUID()
const emails = { hr: `ha07-hr-${companyId}@example.test`, manager: `ha07-manager-${companyId}@example.test`, employee: `ha07-employee-${companyId}@example.test` }
let hr: APIRequestContext
let manager: APIRequestContext
let employee: APIRequestContext
const correlation = randomUUID()

test.beforeAll(async ({ playwright }) => {
  const hash = await bcrypt.hash(password!, 4)
  await pool.query('INSERT INTO companies (id, name, email_domain) VALUES ($1, $2, $3)', [companyId, 'HA-07 test', `${companyId}.test`])
  for (const [id, email, role, parent] of [
    [hrId, emails.hr, 'hr_admin', null], [managerId, emails.manager, 'manager', null], [employeeId, emails.employee, 'employee', managerId],
  ]) {
    await pool.query('INSERT INTO users (id, company_id, name, email, password_hash, role, manager_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, companyId, 'HA-07 fixture', email, hash, role, parent])
  }
  for (const [id, status] of [[pendingId, 'pending'], [decidedId, 'approved']]) {
    await pool.query('INSERT INTO expense_notes (id, user_id, amount, expense_date, description, receipt_key, status) VALUES ($1,$2,42.50,$3,$4,$5,$6)', [id, employeeId, '2026-10-21', 'HA-07 fixture', 'test/receipt.png', status])
  }
  async function signIn(email: string) {
    const context = await playwright.request.newContext({ baseURL })
    const csrf = await (await context.get('/api/auth/csrf')).json()
    const response = await context.post('/api/auth/callback/credentials', {
      form: { csrfToken: csrf.csrfToken, email, password: password!, callbackUrl: `${baseURL}/expenses` },
      maxRedirects: 0,
    })
    expect(response.status()).toBe(302)
    const session = await (await context.get('/api/auth/session')).json()
    expect(session.user?.email).toBe(email)
    return context
  }
  hr = await signIn(emails.hr)
  manager = await signIn(emails.manager)
  employee = await signIn(emails.employee)
})

test.afterAll(async () => {
  await Promise.all([hr?.dispose(), manager?.dispose(), employee?.dispose()])
  // Only rows bearing this run's random IDs are deleted; no reset or truncate of an existing database.
  await pool.query('DELETE FROM expense_notes WHERE id = ANY($1::uuid[])', [[pendingId, decidedId]])
  await pool.query('DELETE FROM users WHERE id = $1', [employeeId])
  await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[hrId, managerId]])
  await pool.query('DELETE FROM companies WHERE id = $1', [companyId])
  await pool.end()
})

async function problem(response: APIResponse, status: number) {
  expect(response.status()).toBe(status)
  expect(response.headers()['content-type']).toContain('application/problem+json')
  const body = await response.json()
  expect(body.status).toBe(status)
  expect(body.error).toBe(body.detail)
  expect(body.requestId).toBe(response.headers()['x-request-id'])
  expect(body).not.toHaveProperty('stack')
  expect(JSON.stringify(body)).not.toContain(password)
  expect(JSON.stringify(body)).not.toContain('SELECT')
  expect(JSON.stringify(body)).not.toContain('postgres://')
  return body
}

test('unauthenticated HTTP request has a correlated 401', async ({ request }) => {
  const response = await request.get(`${baseURL}/api/hr/users`, { headers: { 'X-Request-Id': correlation } })
  const body = await problem(response, 401)
  expect(body.requestId).toBe(correlation)
})

test('authenticated employee receives 403 from the manager operation', async () => {
  await problem(await employee.get('/api/manager/expense-notes'), 403)
})

test('missing resource returns 404 without revealing information', async () => {
  await problem(await manager.post(`/api/manager/expense-notes/${randomUUID()}/approve`), 404)
})

test('an already decided expense returns 409 and keeps its state', async () => {
  await problem(await manager.post(`/api/manager/expense-notes/${decidedId}/reject`), 409)
  expect((await pool.query('SELECT status FROM expense_notes WHERE id = $1', [decidedId])).rows[0].status).toBe('approved')
})

test('invalid assignment JSON or shape returns 400 and keeps the previous manager', async () => {
  for (const body of ['{', '{}', 'null', '{"managerId":42}']) {
    await problem(await hr.put(`/api/hr/users/${employeeId}/manager`, { data: body, headers: { 'content-type': 'application/json' } }), 400)
    expect((await pool.query('SELECT manager_id FROM users WHERE id = $1', [employeeId])).rows[0].manager_id).toBe(managerId)
  }
})

test('a real PostgreSQL rejection after await becomes a sanitized 500', async () => {
  // A malformed UUID reaches the existing SQL query and PostgreSQL rejects it (22P02).
  // HA-07 tests the exception boundary, not future resource-ID validation.
  const response = await manager.post('/api/manager/expense-notes/not-a-uuid/approve', { headers: { 'X-Request-Id': correlation } })
  const body = await problem(response, 500)
  expect(body.type).toBe('urn:expense-io:problem:technical_failure')
  expect(body.requestId).toBe(correlation)
  expect(JSON.stringify(body)).not.toContain('not-a-uuid')
})

test('the authorized list retains its success representation', async () => {
  const response = await manager.get('/api/manager/expense-notes')
  expect(response.status()).toBe(200)
  const notes = (await response.json()).items
  expect(notes).toContainEqual({
    id: pendingId, userId: employeeId, amount: 42.5, expenseDate: '2026-10-21', description: 'HA-07 fixture',
    receiptKey: 'test/receipt.png', status: 'pending', createdAt: expect.any(String),
    author: { id: employeeId, displayName: 'HA-07 fixture' },
  })
})
