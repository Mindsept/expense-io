import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { readTestIdentity, readTestTarget } from '../../../support/test-target'
import { assertResponse } from '../../../contracts/leandro/LE-10/openapi'
import { startOcrApp } from '../../../contracts/leandro/LE-05/http-harness'

const target = readTestTarget()
const database = process.env.DATABASE_URL
if (!database || !new URL(database).pathname.endsWith('_test') || !['127.0.0.1', 'localhost'].includes(new URL(database).hostname) || !process.env.AUTH_SECRET) throw new Error('LE-05 requires explicit isolated database and authentication settings')
const pool = new Pool({ connectionString: database })
const company = randomUUID(), otherCompany = randomUUID(), user = randomUUID(), deleted = randomUUID()
const password = readTestIdentity('EMPLOYEE').password
const png = readFileSync('tests/fixtures/leandro/LE-04/images/leap-day.png')
const blank = readFileSync('tests/fixtures/leandro/LE-04/images/blank.png')
const endpoint = '/api/expense-notes/receipt-suggestion'
let client: APIRequestContext, limited: APIRequestContext, deletedClient: APIRequestContext
let app: Awaited<ReturnType<typeof startOcrApp>> | undefined
let cookie = '', limitedCookie = ''
async function login(context: APIRequestContext, id: string) {
  const { csrfToken } = await (await context.get('/api/auth/csrf')).json()
  expect((await context.post('/api/auth/callback/credentials', { form: { csrfToken, email: `${id}@example.test`, password }, maxRedirects: 0 })).status()).toBe(302)
  expect((await (await context.get('/api/auth/session')).json()).user.id).toBe(id)
  return (await context.storageState()).cookies.map(item => `${item.name}=${item.value}`).join('; ')
}
async function post(context = client, buffer = png, mime = 'image/png') {
  return context.post(endpoint, { multipart: { receipt: { name: 'synthetic', mimeType: mime, buffer } }, maxRetries: 0 })
}
async function checked(response: Awaited<ReturnType<typeof post>>, status: number, code?: string) {
  expect(response.status()).toBe(status)
  const result = await response.json()
  assertResponse(endpoint, 'post', status, response.headers(), result)
  if (code) expect(result.type).toBe(`urn:expense-io:problem:${code}`)
  expect(JSON.stringify(result)).not.toMatch(new RegExp(`${password}|${user}|${company}|${deleted}|X-Amz-|SELECT |cookie|password_hash`))
  return result
}
function raw(baseURL: string, path: string, headers: Record<string, string>, chunks: Buffer[], stall = false) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; result: Record<string, unknown> }>((resolve, reject) => {
    let responding = false
    const deadline = setTimeout(() => { request.destroy(); reject(new Error('Isolated LE-05 response timed out')) }, 10_000)
    const request = http.request(new URL(path, baseURL), { method: 'POST', headers }, response => {
      responding = true
      const data: Buffer[] = []; response.on('data', chunk => data.push(chunk))
      response.on('end', () => { clearTimeout(deadline); request.destroy(); resolve({ status: response.statusCode!, headers: response.headers, result: JSON.parse(Buffer.concat(data).toString()) }) })
      response.on('error', error => { clearTimeout(deadline); reject(error) })
    })
    request.on('error', error => {
      // An early 413 can close the upload socket while writes are outstanding.
      // Still require its actual HTTP response; never accept EPIPE as proof.
      if (['EPIPE', 'ECONNRESET'].includes((error as NodeJS.ErrnoException).code ?? '')) return
      if (!responding) { clearTimeout(deadline); reject(error) }
    })
    let index = 0
    const write = () => {
      if (responding || request.destroyed) return
      while (index < chunks.length) {
        if (!request.write(chunks[index++])) { request.once('drain', write); return }
      }
      if (!stall) request.end()
    }
    write()
  })
}

test.beforeAll(async ({ playwright }) => {
  for (const id of [company, otherCompany]) await pool.query('INSERT INTO companies (id,name,email_domain) VALUES ($1,$2,$3)', [id, 'LE-05 synthetic', `${id}.test`])
  const hash = await bcrypt.hash(password, 4)
  for (const id of [user, deleted]) await pool.query('INSERT INTO users (id,company_id,name,email,password_hash) VALUES ($1,$2,$3,$4,$5)', [id, company, 'Synthetic employee', `${id}@example.test`, hash])
  client = await playwright.request.newContext({ baseURL: target })
  deletedClient = await playwright.request.newContext({ baseURL: target })
  cookie = await login(client, user); await login(deletedClient, deleted)
  app = await startOcrApp({ OCR_TASK_TIMEOUT_MS: '100', OCR_QUEUE_LIMIT: '0', OCR_BODY_TIMEOUT_MS: '200' })
  limited = await playwright.request.newContext({ baseURL: app.url })
  limitedCookie = await login(limited, user)
})
test.afterAll(async () => {
  await Promise.all([client?.dispose(), deletedClient?.dispose(), limited?.dispose()])
  await app?.stop()
  await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[user, deleted]])
  await pool.query('DELETE FROM companies WHERE id=ANY($1::uuid[])', [[company, otherCompany]])
  await pool.end()
})

test('real OCR returns fields, and only successful empty analysis returns 200 empty', async () => {
  expect(await checked(await post(), 200)).toEqual({ amount: 12.5, expenseDate: '2024-02-29' })
  expect(await checked(await post(client, blank), 200)).toEqual({})
})
test('PDF is explicitly refused independently of expense receipt acceptance', async () => {
  await checked(await post(client, readFileSync('tests/fixtures/leandro/LE-01/valid.pdf'), 'application/pdf'), 415, 'unsupported_ocr_media')
})
test('empty, malformed, duplicate and excessive images have explicit bounded failures', async () => {
  await checked(await post(client, Buffer.from('')), 400, 'validation')
  await checked(await post(client, Buffer.from('not image')), 400, 'validation')
  await checked(await post(client, Buffer.alloc(5 * 1024 * 1024 + 1)), 413, 'payload_too_large')
  const form = new FormData()
  form.append('receipt', new Blob([png], { type: 'image/png' }), 'one.png')
  form.append('receipt', new Blob([png], { type: 'image/png' }), 'two.png')
  const response = await fetch(new URL(endpoint, target), { method: 'POST', body: form, headers: { cookie } })
  expect(response.status).toBe(400)
  assertResponse(endpoint, 'post', response.status, Object.fromEntries(response.headers), await response.json())
})
test('actual chunked HTTP without Content-Length is bounded before multipart materialization on both routes', async () => {
  for (const [path, bytes] of [[endpoint, 5 * 1024 * 1024 + 65536], ['/api/expense-notes', 10 * 1024 * 1024 + 65536]] as const) {
    // Finish a chunked body exactly one byte over the actual envelope. This
    // proves the boundary while avoiding a TCP reset from megabytes of writes
    // still pending after the server has correctly refused an earlier chunk.
    const chunks = [...Array.from({ length: bytes / 65536 }, () => Buffer.alloc(65536)), Buffer.alloc(1)]
    const response = await raw(target, path, { cookie, 'content-type': 'multipart/form-data; boundary=le05' }, chunks)
    expect(response.status).toBe(413)
    assertResponse(path, 'post', response.status, response.headers as Record<string, string>, response.result)
    expect(response.result.type).toBe('urn:expense-io:problem:payload_too_large')
  }
  expect((await pool.query('SELECT count(*)::int AS count FROM expense_notes WHERE user_id=$1', [user])).rows[0].count).toBe(0)
})
test('slow unfinished real request is cancelled at its body reading deadline', async () => {
  const response = await raw(app!.url, endpoint, { cookie: limitedCookie, 'content-type': 'multipart/form-data; boundary=le05' }, [Buffer.from('--le05\r\n')], true)
  expect(response.status).toBe(408)
  assertResponse(endpoint, 'post', response.status, response.headers as Record<string, string>, response.result)
})
test('real initialization timeout, saturation and released capacity remain distinct', async () => {
  const results = await Promise.all([post(limited), post(limited), post(limited)])
  expect(results.map(result => result.status()).sort()).toEqual([503, 503, 504])
  for (const response of results) await checked(response, response.status(), response.status() === 504 ? 'ocr_timeout' : 'ocr_busy')
  await checked(await post(limited), 504, 'ocr_timeout') // capacity actually recovered, never remains busy
})
test('deleted and inactive old sessions cannot start OCR; current active roles and company still work', async () => {
  await pool.query('DELETE FROM users WHERE id=$1', [deleted])
  await checked(await post(deletedClient), 401, 'unauthenticated')
  await pool.query('UPDATE users SET is_active=false WHERE id=$1', [user])
  await checked(await post(), 401, 'unauthenticated')
  await pool.query("UPDATE users SET is_active=true,role='manager',company_id=$2 WHERE id=$1", [user, otherCompany])
  expect(await checked(await post(), 200)).toEqual({ amount: 12.5, expenseDate: '2024-02-29' })
  await pool.query("UPDATE users SET role='hr_admin' WHERE id=$1", [user])
  expect(await checked(await post(), 200)).toEqual({ amount: 12.5, expenseDate: '2024-02-29' })
})

test('a real decoder failure is 502 and the following valid image still succeeds', async () => {
  // Structurally bounded JPEG SOF/SOS, with invalid compressed image data.
  const broken = Buffer.from([255,216,255,192,0,8,8,0,16,0,16,1,255,218,0,6,1,1,0,0,1,255,217])
  await checked(await post(client, broken, 'image/jpeg'), 502, 'ocr_failure')
  expect(await checked(await post(), 200)).toEqual({ amount: 12.5, expenseDate: '2024-02-29' })
})
