import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test'

const baseURL = process.env.LE01_TEST_BASE_URL
const databaseURL = process.env.LE01_TEST_DATABASE_URL
const bucket = process.env.S3_BUCKET
if (!baseURL || !databaseURL || !bucket) throw new Error('LE-01 requires explicit test server, database and bucket settings.')
const storageURL = new URL(process.env.S3_ENDPOINT ?? '')
if (![new URL(baseURL), new URL(databaseURL), storageURL].every(url => ['localhost', '127.0.0.1'].includes(url.hostname)) ||
    !decodeURIComponent(new URL(databaseURL).pathname).endsWith('_test') || !bucket.endsWith('-test')) {
  throw new Error('LE-01 refuses non-local services or database/bucket names without test suffixes.')
}
const pool = new Pool({ connectionString: databaseURL })
const s3 = new S3Client({ endpoint: storageURL.href, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } })
const companyId = randomUUID()
const otherCompanyId = randomUUID()
const userId = randomUUID()
const otherUserId = randomUUID()
const seededIds = [randomUUID(), randomUUID(), randomUUID()]
const email = `le01-${userId}@example.test`
const password = randomBytes(24).toString('base64url')
const requestId = randomUUID()
const sorts = ['created_at DESC', 'created_at ASC', 'amount DESC', 'amount ASC', 'expense_date DESC', 'expense_date ASC']
let client: APIRequestContext
let png: Buffer

test.beforeAll(async ({ playwright }) => {
  png = await readFile('tests/fixtures/leandro/LE-01/valid.png')
  for (const id of [companyId, otherCompanyId]) await pool.query('INSERT INTO companies (id,name,email_domain) VALUES ($1,$2,$3)', [id, 'LE-01 synthetic', `${id}.test`])
  for (const [id, company] of [[userId, companyId], [otherUserId, otherCompanyId]]) {
    await pool.query('INSERT INTO users (id,company_id,name,email,password_hash) VALUES ($1,$2,$3,$4,$5)', [id, company, 'Synthetic employee', `le01-${id}@example.test`, await bcrypt.hash(password, 4)])
  }
  for (let index = 0; index < 3; index++) await pool.query(
    'INSERT INTO expense_notes (id,user_id,amount,expense_date,description,receipt_key,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [seededIds[index], userId, index + 1, `2024-02-${27 + index}`, 'Synthetic sort fixture', 'test/legacy.png', `2026-10-${20 + index}T10:00:00Z`],
  )
  await pool.query('INSERT INTO expense_notes (user_id,amount,expense_date,description,receipt_key) VALUES ($1,999,$2,$3,$4)', [otherUserId, '2024-02-29', 'Other company', 'test/other.png'])
  client = await playwright.request.newContext({ baseURL })
  const { csrfToken } = await (await client.get('/api/auth/csrf')).json()
  const response = await client.post('/api/auth/callback/credentials', { form: { csrfToken, email, password, callbackUrl: `${baseURL}/expenses` }, maxRedirects: 0 })
  expect(response.status()).toBe(302)
  expect((await (await client.get('/api/auth/session')).json()).user.id).toBe(userId)
})

test.afterAll(async () => {
  await client?.dispose()
  const uploaded = await pool.query('SELECT receipt_key FROM expense_notes WHERE user_id = $1 AND NOT (id = ANY($2::uuid[]))', [userId, seededIds])
  for (const row of uploaded.rows) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: row.receipt_key }))
  await pool.query('DELETE FROM expense_notes WHERE user_id = ANY($1::uuid[])', [[userId, otherUserId]])
  await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userId, otherUserId]])
  await pool.query('DELETE FROM companies WHERE id = ANY($1::uuid[])', [[companyId, otherCompanyId]])
  await pool.end()
  s3.destroy()
})

async function state() {
  const rows = await pool.query('SELECT count(*)::int AS count FROM expense_notes')
  // The disposable bucket has fewer than 1000 objects. Refuse a truncated view.
  const objects = await s3.send(new ListObjectsV2Command({ Bucket: bucket }))
  expect(objects.IsTruncated).not.toBe(true)
  return { count: rows.rows[0].count, keys: (objects.Contents ?? []).map(object => object.Key).sort() }
}

async function problem(response: APIResponse, status = 400) {
  expect(response.status()).toBe(status)
  expect(response.headers()['content-type']).toContain('application/problem+json')
  const body = await response.json()
  expect(body).toMatchObject({ status, requestId })
  expect(body.error).toBe(body.detail)
  expect(response.headers()['x-request-id']).toBe(requestId)
  expect(body).not.toHaveProperty('stack')
  expect(JSON.stringify(body)).not.toContain(password)
}

for (const sort of ['constructor', '__proto__', 'unknown', 'created_at DESC; SELECT 1', 'amount DESC --']) {
  test(`HTTP rejects sort ${sort} without changing DB/S3`, async () => {
    const before = await state()
    await problem(await client.get('/api/expense-notes', { params: { sort }, headers: { 'X-Request-Id': requestId } }))
    expect(await state()).toEqual(before)
  })
}

for (const sort of sorts) {
  test(`HTTP preserves safe ordering ${sort} and the personal filter`, async () => {
    const response = await client.get('/api/expense-notes', { params: { sort } })
    expect(response.status()).toBe(200)
    const notes = await response.json()
    const orderedIds = sort.endsWith('ASC') ? seededIds : [...seededIds].reverse()
    expect(notes.map((note: { id: string }) => note.id)).toEqual(orderedIds)
    expect(notes.every((note: { userId: string }) => note.userId === userId)).toBe(true)
  })
}

const invalidCases = [
  ['amount', '12.34garbage'], ['amount', '1e2'], ['amount', '12.345'], ['amount', '100000000.00'],
  ['amount', 'NaN'], ['amount', 'Infinity'], ['expenseDate', '2023-02-29'], ['expenseDate', '2026-04-31'],
  ['description', 'x'.repeat(4001)], ['description', '   '],
] as const
for (const [index, [field, value]] of invalidCases.entries()) {
  test(`HTTP invalid field ${field}, case ${index + 1}, writes neither a note nor an object`, async () => {
    const before = await state()
    await problem(await client.post('/api/expense-notes', { headers: { 'X-Request-Id': requestId }, multipart: {
      amount: '12.34', expenseDate: '2024-02-29', description: 'Synthetic receipt', [field]: value,
      receipt: { name: 'valid.png', mimeType: 'image/png', buffer: png },
    } }))
    expect(await state()).toEqual(before)
  })
}

for (const [index, [buffer, mimeType]] of [
  [Buffer.alloc(0), 'image/png'], [Buffer.from('ordinary text'), 'image/png'],
  [Buffer.from('%PDF-1.7\nnot a complete document'), 'application/pdf'],
].entries()) {
  test(`HTTP rejects empty/spoofed/truncated receipt ${index + 1} without mutation`, async () => {
    const before = await state()
    await problem(await client.post('/api/expense-notes', { headers: { 'X-Request-Id': requestId }, multipart: {
      amount: '12.34', expenseDate: '2024-02-29', description: 'Synthetic receipt',
      receipt: { name: 'spoofed.png', mimeType: mimeType as string, buffer: buffer as Buffer },
    } }))
    expect(await state()).toEqual(before)
  })
}

for (const [name, mimeType] of [['valid.png', 'image/png'], ['valid.jpg', 'image/jpeg'], ['progressive.jpg', 'image/jpeg'], ['valid.webp', 'image/webp'], ['lossless.webp', 'image/webp'], ['valid.pdf', 'application/pdf']]) {
  test(`HTTP accepts real ${name}, preserves decimal/date and stores exact bytes`, async () => {
    const bytes = await readFile(`tests/fixtures/leandro/LE-01/${name}`)
    const response = await client.post('/api/expense-notes', { multipart: {
      amount: '99999999.99', expenseDate: '2099-12-31', description: '  Synthetic receipt  ',
      receipt: { name: 'untrusted-name.exe', mimeType, buffer: bytes },
    } })
    expect(response.status()).toBe(201)
    const note = await response.json()
    expect(note).toMatchObject({ userId, amount: 99999999.99, expenseDate: '2099-12-31', description: 'Synthetic receipt', status: 'pending' })
    expect(note.receiptKey).toMatch(new RegExp(`\\${name.slice(name.lastIndexOf('.'))}$`))
    const stored = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: note.receiptKey }))
    expect(Buffer.from(await stored.Body!.transformToByteArray())).toEqual(bytes)
  })
}
