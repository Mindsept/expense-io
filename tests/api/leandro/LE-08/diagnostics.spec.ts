import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { readTestIdentity, readTestTarget } from '../../../support/test-target'
import { DiagnosticHarness } from '../../../contracts/leandro/LE-08/http-harness'

readTestTarget()
const databaseURL = process.env.DATABASE_URL, endpoint = process.env.S3_ENDPOINT, bucket = process.env.S3_BUCKET
if (!databaseURL || !endpoint || !bucket || !process.env.AUTH_SECRET || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY ||
    !new URL(databaseURL).pathname.endsWith('_test') || !bucket.endsWith('-test') ||
    ![databaseURL, endpoint].every(value => ['localhost','127.0.0.1'].includes(new URL(value).hostname))) throw new Error('LE-08 requires explicit isolated database/storage/authentication settings')
const pool = new Pool({ connectionString: databaseURL })
const s3 = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } })
const harness = new DiagnosticHarness(new URL(endpoint)), timeoutHarness = new DiagnosticHarness(new URL(endpoint))
const company = randomUUID(), employee = randomUUID(), manager = randomUUID(), password = readTestIdentity('EMPLOYEE').password
const png = readFileSync('tests/fixtures/leandro/LE-04/images/leap-day.png')
let employeeClient: APIRequestContext, managerClient: APIRequestContext, timeoutClient: APIRequestContext
async function login(client: APIRequestContext, id: string) {
  const { csrfToken } = await (await client.get('/api/auth/csrf')).json()
  expect((await client.post('/api/auth/callback/credentials', { form: { csrfToken, email: `${id}@example.test`, password }, maxRedirects: 0 })).status()).toBe(302)
  expect((await (await client.get('/api/auth/session')).json()).user.id).toBe(id)
}
function submit(requestId: string) {
  return employeeClient.post('/api/expense-notes', { headers: { 'X-Request-Id': requestId }, multipart: {
    amount: '12.50', expenseDate: '2024-02-29', description: 'LE-08 synthetic', receipt: { name: 'synthetic.png', mimeType: 'image/png', buffer: png },
  } })
}
function exportLogs(source: DiagnosticHarness, requestId?: string) {
  const args = ['scripts/leandro/LE-08/export.mjs', '--input', '-']
  if (requestId) args.push('--request-id', requestId)
  const env = { ...process.env }; delete env.FORCE_COLOR
  const result = spawnSync(process.execPath, args, { input: source.exportLines(), env, encoding: 'utf8', timeout: 5000 })
  expect(result.status).toBe(0); expect(result.stderr).toBe('')
  expect(result.stdout).not.toMatch(new RegExp(`${password}|${employee}|${manager}|${company}|X-Amz-|password_hash|synthetic.png|SELECT |INSERT `))
  return JSON.parse(result.stdout)
}

test.beforeAll(async ({ playwright }) => {
  await pool.query('INSERT INTO companies (id,name,email_domain) VALUES ($1,$2,$3)', [company, 'LE-08 synthetic', `${company}.test`])
  const hash = await bcrypt.hash(password, 4)
  for (const [id, role] of [[manager, 'manager'],[employee, 'employee']]) await pool.query('INSERT INTO users (id,company_id,name,email,password_hash,role) VALUES ($1,$2,$3,$4,$5,$6)', [id, company, 'Synthetic actor', `${id}@example.test`, hash, role])
  await pool.query('UPDATE users SET manager_id=$1 WHERE id=$2', [manager, employee])
  await harness.start(); await timeoutHarness.start({ OCR_TASK_TIMEOUT_MS: '100' })
  employeeClient = await playwright.request.newContext({ baseURL: harness.url })
  managerClient = await playwright.request.newContext({ baseURL: harness.url })
  timeoutClient = await playwright.request.newContext({ baseURL: timeoutHarness.url })
  await login(employeeClient, employee); await login(managerClient, manager); await login(timeoutClient, employee)
})
test.afterAll(async () => {
  await Promise.all([employeeClient?.dispose(), managerClient?.dispose(), timeoutClient?.dispose()])
  await harness.stop(); await timeoutHarness.stop()
  const receipts = await pool.query('SELECT receipt_key FROM expense_notes WHERE user_id=$1', [employee])
  await pool.query('DELETE FROM expense_decision_history WHERE company_id=$1', [company])
  await pool.query('DELETE FROM expense_notes WHERE user_id=$1', [employee])
  for (const row of receipts.rows) if (row.receipt_key) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: row.receipt_key }))
  await pool.query('DELETE FROM users WHERE company_id=$1', [company])
  await pool.query('DELETE FROM companies WHERE id=$1', [company])
  await pool.end(); s3.destroy()
})

test('real storage failure is correlated to HTTP and a successful subsequent submission', async () => {
  const requestId = randomUUID(); harness.failPuts = true
  try {
    const response = await submit(requestId)
    expect(response.status()).toBe(500)
    expect((await response.json()).requestId).toBe(requestId)
    await expect.poll(() => harness.events.some(event => event.requestId === requestId && event.operation === 'storage.upload')).toBe(true)
    const exported = exportLogs(harness, requestId)
    expect(exported.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ requestId, operation: 'storage.upload', code: 'storage_upload_failed', result: 'error', attempt: 1 }),
      expect.objectContaining({ requestId, operation: 'expense-notes.submit', code: 'http_5xx' }),
    ]))
    expect((await pool.query('SELECT count(*)::int AS count FROM expense_notes WHERE user_id=$1', [employee])).rows[0].count).toBe(0)
  } finally { harness.failPuts = false }
  const successId = randomUUID(), success = await submit(successId)
  expect(success.status()).toBe(201)
  await expect.poll(() => harness.events.some(event => event.requestId === successId && event.operation === 'expense.persist')).toBe(true)
  expect(exportLogs(harness, successId).events).toEqual(expect.arrayContaining([
    expect.objectContaining({ operation: 'storage.upload', code: 'success' }), expect.objectContaining({ operation: 'expense.persist', code: 'success' }),
  ]))
})
test('real decision success and conflict feed the published HA-03 composition hook and native diagnostics', async () => {
  const created = await submit(randomUUID()); expect(created.status()).toBe(201)
  const { id } = await created.json()
  for (const [status, result] of [[200, 'success'],[409, 'conflict']] as const) {
    const requestId = randomUUID()
    const response = await managerClient.post(`/api/manager/expense-notes/${id}/approve`, { headers: { 'X-Request-Id': requestId } })
    expect(response.status()).toBe(status)
    await expect.poll(() => harness.events.some(event => event.requestId === requestId && event.operation === 'DecideExpense')).toBe(true)
    expect(exportLogs(harness, requestId).events).toContainEqual(expect.objectContaining({ operation: 'DecideExpense', result, requestId }))
  }
  const aggregate = exportLogs(harness)
  expect(aggregate.series).toEqual(expect.arrayContaining([expect.objectContaining({ operation: 'DecideExpense', code: 'decision_success' }), expect.objectContaining({ operation: 'DecideExpense', code: 'decision_conflict' })]))
  expect(JSON.stringify(aggregate)).not.toMatch(/requestId|noteId|userId|companyId/)
})
test('real empty analysis and actual initialization timeout produce different diagnostic codes and capacity samples', async () => {
  const emptyId = randomUUID(), timeoutId = randomUUID()
  const empty = await employeeClient.post('/api/expense-notes/receipt-suggestion', { headers: { 'X-Request-Id': emptyId }, multipart: { receipt: { name: 'blank.png', mimeType: 'image/png', buffer: readFileSync('tests/fixtures/leandro/LE-04/images/blank.png') } } })
  expect(empty.status()).toBe(200); expect(await empty.json()).toEqual({})
  const timed = await timeoutClient.post('/api/expense-notes/receipt-suggestion', { headers: { 'X-Request-Id': timeoutId }, multipart: { receipt: { name: 'image.png', mimeType: 'image/png', buffer: png } } })
  expect(timed.status()).toBe(504)
  await expect.poll(() => timeoutHarness.events.some(event => event.operation === 'ocr.recognize' && event.requestId === timeoutId)).toBe(true)
  expect(exportLogs(harness, emptyId).events).toContainEqual(expect.objectContaining({ operation: 'ocr.recognize', code: 'ocr_empty', result: 'success', capacity: { workers: 1, active: 0, queued: 0, stopping: 0 } }))
  expect(exportLogs(timeoutHarness, timeoutId).events).toContainEqual(expect.objectContaining({ operation: 'ocr.recognize', code: 'ocr_timeout', result: 'error', capacity: { workers: 0, active: 0, queued: 0, stopping: 0 } }))
})
