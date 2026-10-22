import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test'
import { readTestTarget } from '../../../support/test-target'
import { assertResponse, contract, methods, type Operation } from '../../../contracts/leandro/LE-10/openapi'

const baseURL = readTestTarget()
const databaseURL = process.env.DATABASE_URL
const bucket = process.env.S3_BUCKET
if (!databaseURL || !bucket || !process.env.S3_ENDPOINT || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) throw new Error('LE-10 requires explicit isolated PostgreSQL/S3 settings from the shared test runner.')
const database = new URL(databaseURL)
const storage = new URL(process.env.S3_ENDPOINT)
if (![database, storage].every(url => ['localhost', '127.0.0.1'].includes(url.hostname) && url.port && Number(url.port) >= 1024) || !database.pathname.endsWith('_test') || !bucket.endsWith('-test')) throw new Error('LE-10 refuses non-local services or database/bucket names without test suffixes.')
const pool = new Pool({ connectionString: databaseURL })
const s3 = new S3Client({ endpoint: storage.href, region: process.env.S3_REGION ?? 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } })
const companyA = randomUUID()
const companyB = randomUUID()
const ids = { manager: randomUUID(), employee: randomUUID(), hr: randomUUID(), peer: randomUUID(), foreign: randomUUID() }
const password = randomBytes(24).toString('base64url')
const requestId = randomUUID()
const owners: Record<string, string> = { employee: ids.employee, manager: ids.manager, hr: ids.hr, peer: ids.peer, foreign: ids.foreign, blank: ids.employee, managerApprove: ids.employee, managerReject: ids.employee, hrApprove: ids.manager, hrReject: ids.manager }
const notes = Object.fromEntries(Object.keys(owners).map(key => [key, randomUUID()]))
const clients: Record<string, APIRequestContext> = {}
let anonymous: APIRequestContext
const png = readFileSync('tests/fixtures/leandro/LE-04/images/leap-day.png')

async function checked(response: APIResponse, path: string, method: string, status: number) {
  expect(response.status()).toBe(status)
  const body: unknown = await response.json()
  assertResponse(path, method, response.status(), response.headers(), body)
  return body as Record<string, unknown>
}
async function problem(response: APIResponse, path: string, method: string, status: number) {
  const body = await checked(response, path, method, status)
  // A schema check alone cannot prove tenant isolation. Also assert there is no
  // fixture value, resource identifier, credential or signed URL in the refusal.
  const text = JSON.stringify(body)
  for (const secret of [password, companyA, companyB, ...Object.values(ids), ...Object.values(notes), 'synthetic-le10/', 'X-Amz-']) expect(text.includes(secret)).toBe(false)
  return body
}

test.beforeAll(async ({ playwright }) => {
  const hash = await bcrypt.hash(password, 4)
  for (const company of [companyA, companyB]) await pool.query('INSERT INTO companies (id,name,email_domain) VALUES ($1,$2,$3)', [company, 'LE-10 synthetic', `${company}.test`])
  for (const [name, id] of Object.entries(ids)) {
    const role = name === 'manager' ? 'manager' : ['hr', 'peer'].includes(name) ? 'hr_admin' : 'employee'
    await pool.query('INSERT INTO users (id,company_id,name,email,password_hash,role,manager_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, name === 'foreign' ? companyB : companyA, `LE-10 ${name}`, `${id}@example.test`, hash, role, name === 'employee' ? ids.manager : null])
  }
  for (const [name, id] of Object.entries(notes)) {
    const owner = owners[name]
    await pool.query('INSERT INTO expense_notes (id,user_id,amount,expense_date,description,receipt_key) VALUES ($1,$2,12.50,$3,$4,$5)', [id, owner, '2024-02-29', 'LE-10 synthetic taxi', name === 'blank' ? '  ' : `synthetic-le10/${id}.png`])
  }
  anonymous = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { 'X-Request-Id': requestId } })
  for (const [name, id] of Object.entries(ids)) {
    const client = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { 'X-Request-Id': requestId } })
    clients[name] = client
    const csrf = await checked(await client.get('/api/auth/csrf'), '/api/auth/csrf', 'get', 200)
    const login = await client.post('/api/auth/callback/credentials', { form: { csrfToken: String(csrf.csrfToken), email: `${id}@example.test`, password, callbackUrl: `${baseURL}/expenses` }, maxRedirects: 0 })
    expect(login.status()).toBe(302)
    expect(login.headers().location).toBe(`${baseURL}/expenses`)
    const session = await checked(await client.get('/api/auth/session'), '/api/auth/session', 'get', 200)
    expect((session.user as { id: string }).id).toBe(id)
  }
})

test.afterAll(async () => {
  await Promise.all(Object.values(clients).map(client => client.dispose()))
  await anonymous?.dispose()
  try {
    // Only receipts created by this suite's own synthetic accounts are eligible.
    const result = await pool.query('SELECT receipt_key FROM expense_notes WHERE user_id = ANY($1::uuid[])', [Object.values(ids)])
    for (const row of result.rows) if (typeof row.receipt_key === 'string' && row.receipt_key.startsWith('receipts/')) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: row.receipt_key }))
  } finally {
    await pool.query('DELETE FROM expense_notes WHERE user_id = ANY($1::uuid[])', [Object.values(ids)])
    await pool.query('UPDATE users SET manager_id = NULL WHERE id = ANY($1::uuid[])', [Object.values(ids)])
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [Object.values(ids)])
    await pool.query('DELETE FROM companies WHERE id = ANY($1::uuid[])', [[companyA, companyB]])
    await pool.end()
    s3.destroy()
  }
})

const businessOperations = Object.entries(contract.paths).flatMap(([path, item]) => methods.filter(method => item[method] && !(item[method] as Operation)['x-delegated']).map(method => ({ path, method })))
for (const { path, method } of businessOperations) {
  test(`${method.toUpperCase()} ${path}: real 401 obeys its delivered error contract`, async () => {
    await problem(await anonymous.fetch(path.replace('{id}', randomUUID()), { method }), path, method, 401)
  })
}

test('current employee receives schema-checked 403 for all manager and HR operations', async () => {
  for (const { path, method } of businessOperations.filter(({ path }) => /^\/api\/(manager|hr)\//.test(path))) {
    await problem(await clients.employee.fetch(path.replace('{id}', randomUUID()), { method }), path, method, 403)
  }
})

test('personal, manager, HR and directory lists validate real field types and stay in scope', async () => {
  for (const [name, path, expectedId] of [
    ['employee', '/api/expense-notes', notes.employee],
    ['manager', '/api/manager/expense-notes', notes.employee],
    ['hr', '/api/hr/expense-notes', notes.peer],
    ['hr', '/api/hr/users', ids.employee],
  ]) {
    const response = await clients[name].get(path)
    await checked(response, path, 'get', 200)
    const rows = await response.json() as Array<{ id: string }>
    expect(rows.map(row => row.id)).toContain(expectedId)
    expect(rows.map(row => row.id)).not.toContain(path.endsWith('/users') ? ids.foreign : notes.foreign)
  }
})

test('real multipart submission validates numeric success; a mutated real response fails schema validation', async () => {
  const response = await clients.employee.post('/api/expense-notes', { multipart: { amount: '12.50', expenseDate: '2024-02-29', description: 'LE-10 synthetic submission', receipt: { name: 'synthetic.png', mimeType: 'image/png', buffer: png } } })
  const body = await checked(response, '/api/expense-notes', 'post', 201)
  expect(body.userId).toBe(ids.employee)
  expect(body.amount).toBe(12.5)
  expect(() => assertResponse('/api/expense-notes', 'post', 201, response.headers(), { ...body, amount: '12.50' })).toThrow('OpenAPI schema mismatch:')
  const list = await clients.employee.get('/api/expense-notes?sort=created_at%20DESC')
  await checked(list, '/api/expense-notes', 'get', 200)
  expect((await list.json() as Array<{ id: string }>).some(note => note.id === body.id)).toBe(true)
})

test('legacy invalid multipart, OCR empty suggestion and malformed-ID technical failure match documented statuses', async () => {
  await problem(await clients.employee.post('/api/expense-notes', { multipart: { amount: 'invalid' } }), '/api/expense-notes', 'post', 400)
  await problem(await clients.employee.post('/api/expense-notes/receipt-suggestion', { multipart: { other: 'missing receipt' } }), '/api/expense-notes/receipt-suggestion', 'post', 400)
  const suggestion = await checked(await clients.employee.post('/api/expense-notes/receipt-suggestion', { multipart: { receipt: { name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF synthetic unsupported OCR') } } }), '/api/expense-notes/receipt-suggestion', 'post', 200)
  expect(suggestion).toEqual({})
  await problem(await clients.employee.get('/api/expense-notes/not-a-uuid/receipt-url'), '/api/expense-notes/{id}/receipt-url', 'get', 500)
})

for (const [name, path, own] of [
  ['employee', '/api/expense-notes/{id}/receipt-url', notes.employee],
  ['manager', '/api/manager/expense-notes/{id}/receipt-url', notes.employee],
  ['hr', '/api/hr/expense-notes/{id}/receipt-url', notes.manager],
]) {
  test(`${name}: signed URL success and indistinguishable invisible/missing/blank 404`, async () => {
    const body = await checked(await clients[name].get(path.replace('{id}', own)), path, 'get', 200)
    expect(typeof body.url).toBe('string')
    const invisible = await problem(await clients[name].get(path.replace('{id}', notes.foreign)), path, 'get', 404)
    const missing = await problem(await clients[name].get(path.replace('{id}', randomUUID())), path, 'get', 404)
    expect(invisible).toEqual(missing)
    const blank = name === 'hr' ? notes.manager : notes.blank
    const original = await pool.query('SELECT receipt_key FROM expense_notes WHERE id=$1', [blank])
    try {
      await pool.query("UPDATE expense_notes SET receipt_key='  ' WHERE id=$1", [blank])
      expect(await problem(await clients[name].get(path.replace('{id}', blank)), path, 'get', 404)).toEqual(missing)
    } finally { await pool.query('UPDATE expense_notes SET receipt_key=$1 WHERE id=$2', [original.rows[0].receipt_key, blank]) }
  })
}

for (const name of ['manager', 'hr']) for (const decision of ['approve', 'reject']) {
  test(`${name} ${decision}: 200 DTO, sequential conflict and invisible/self 404`, async () => {
    const path = `/api/${name}/expense-notes/{id}/${decision}`
    const id = notes[name + decision[0].toUpperCase() + decision.slice(1)]
    const body = await checked(await clients[name].post(path.replace('{id}', id)), path, 'post', 200)
    expect(body.status).toBe(decision === 'approve' ? 'approved' : 'rejected')
    await problem(await clients[name].post(path.replace('{id}', id)), path, 'post', 409)
    for (const target of [notes.foreign, notes[name]]) await problem(await clients[name].post(path.replace('{id}', target)), path, 'post', 404)
    expect((await pool.query('SELECT status FROM expense_notes WHERE id=$1', [notes.foreign])).rows[0].status).toBe('pending')
    expect((await pool.query('SELECT status FROM expense_notes WHERE id=$1', [id])).rows[0].status).toBe(body.status)
  })
}

test('manager assignment validates 200/400/404/409 without modifying foreign membership', async () => {
  const path = '/api/hr/users/{id}/manager'
  const target = path.replace('{id}', ids.employee)
  try {
    const cleared = await checked(await clients.hr.put(target, { data: { managerId: null } }), path, 'put', 200)
    expect(cleared.managerId).toBeNull()
    const assigned = await checked(await clients.hr.put(target, { data: { managerId: ids.manager } }), path, 'put', 200)
    expect(assigned.managerId).toBe(ids.manager)
    await problem(await clients.hr.put(target, { data: {} }), path, 'put', 400)
    await problem(await clients.hr.put(target, { data: '{', headers: { 'Content-Type': 'application/json' } }), path, 'put', 400)
    await problem(await clients.hr.put(path.replace('{id}', ids.foreign), { data: { managerId: null } }), path, 'put', 404)
    await problem(await clients.hr.put(target, { data: { managerId: ids.foreign } }), path, 'put', 409)
    expect((await pool.query('SELECT manager_id FROM users WHERE id=$1', [ids.foreign])).rows[0].manager_id).toBeNull()
    expect((await pool.query('SELECT manager_id FROM users WHERE id=$1', [ids.employee])).rows[0].manager_id).toBe(ids.manager)
  } finally { await pool.query('UPDATE users SET manager_id=$1 WHERE id=$2', [ids.manager, ids.employee]) }
})

test('HA-03 history validates recorded events for current owner/validator and hides foreign notes', async () => {
  const path = '/api/expense-notes/{id}/history'
  // Independent fixture: do not depend on another test's successful decision.
  expect((await pool.query('SELECT status FROM expense_notes WHERE id=$1', [notes.employee])).rows[0].status).toBe('pending')
  await checked(await clients.manager.post(`/api/manager/expense-notes/${notes.employee}/approve`), '/api/manager/expense-notes/{id}/approve', 'post', 200)
  for (const name of ['employee', 'manager']) {
    const response = await clients[name].get(path.replace('{id}', notes.employee))
    await checked(response, path, 'get', 200)
    const { items } = await response.json() as { items: Array<{ fromStatus: string; toStatus: string; actor: { id: string; displayName: string } }> }
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ fromStatus: 'pending', toStatus: 'approved', actor: { id: ids.manager, displayName: 'LE-10 manager' } })
  }
  expect(await checked(await clients.hr.get(path.replace('{id}', notes.peer)), path, 'get', 200)).toEqual({ items: [] })
  for (const name of ['employee', 'manager', 'hr']) await problem(await clients[name].get(path.replace('{id}', notes.foreign)), path, 'get', 404)
})
