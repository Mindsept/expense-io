import { readFileSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'
import { DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { test, expect, type APIRequestContext } from '@playwright/test'

const baseURL = process.env.LE12_TEST_BASE_URL
const databaseURL = process.env.LE12_TEST_DATABASE_URL
const bucket = process.env.S3_BUCKET
if (!baseURL || !databaseURL || !bucket) throw new Error('LE-12 needs an explicitly isolated test server, database and S3 bucket.')
const database = new URL(databaseURL)
const storage = new URL(process.env.S3_ENDPOINT ?? '')
if (![new URL(baseURL), database, storage].every(url => ['localhost', '127.0.0.1'].includes(url.hostname)) ||
    !database.pathname.endsWith('_test') || !bucket.endsWith('-test')) {
  throw new Error('LE-12 refuses non-local services or database/bucket names without test suffixes.')
}
const pool = new Pool({ connectionString: databaseURL })
const s3 = new S3Client({ endpoint: storage.href, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } })
const companyId = randomUUID()
const userId = randomUUID()
const otherUserId = randomUUID()
const email = `le12-${userId}@example.test`
const password = randomBytes(24).toString('base64url')
const png = readFileSync('tests/fixtures/leandro/LE-04/images/large-total.png')
let client: APIRequestContext

test.beforeAll(async ({ playwright }) => {
  await pool.query('INSERT INTO companies (id, name, email_domain) VALUES ($1,$2,$3)', [companyId, 'LE-12 synthetic', `${companyId}.test`])
  for (const [id, address] of [[userId, email], [otherUserId, `le12-${otherUserId}@example.test`]]) {
    await pool.query('INSERT INTO users (id,company_id,name,email,password_hash) VALUES ($1,$2,$3,$4,$5)', [id, companyId, 'Synthetic employee', address, await bcrypt.hash(password, 4)])
  }
  await pool.query('INSERT INTO expense_notes (user_id,amount,expense_date,description,receipt_key) VALUES ($1,99,$2,$3,$4)', [otherUserId, '2024-02-29', 'Other employee', 'test/old.png'])
  client = await playwright.request.newContext({ baseURL })
  const { csrfToken } = await (await client.get('/api/auth/csrf')).json()
  const login = await client.post('/api/auth/callback/credentials', { form: { csrfToken, email, password, callbackUrl: `${baseURL}/expenses` }, maxRedirects: 0 })
  expect(login.status()).toBe(302)
  expect((await (await client.get('/api/auth/session')).json()).user.id).toBe(userId)
})

test.afterAll(async () => {
  await client?.dispose()
  const objects = await pool.query('SELECT receipt_key FROM expense_notes WHERE user_id = $1', [userId])
  for (const row of objects.rows) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: row.receipt_key }))
  await pool.query('DELETE FROM expense_notes WHERE user_id = ANY($1::uuid[])', [[userId, otherUserId]])
  await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userId, otherUserId]])
  await pool.query('DELETE FROM companies WHERE id = $1', [companyId])
  await pool.end()
  s3.destroy()
})

test('real multipart POST and personal GET share the DTO without exposing another employee', async () => {
  const response = await client.post('/api/expense-notes', { multipart: {
    amount: '1234.56', expenseDate: '2024-02-29', description: 'Synthetic taxi',
    receipt: { name: 'synthetic.png', mimeType: 'image/png', buffer: png },
  } })
  expect(response.status()).toBe(201)
  const note = await response.json()
  expect(note).toEqual({ id: expect.any(String), userId, amount: 1234.56, expenseDate: '2024-02-29',
    description: 'Synthetic taxi', receiptKey: expect.any(String), status: 'pending', createdAt: expect.any(String) })
  expect(new Date(note.createdAt).toISOString()).toBe(note.createdAt)
  const stored = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: note.receiptKey }))
  expect(Buffer.from(await stored.Body!.transformToByteArray())).toEqual(png)
  const list = await client.get('/api/expense-notes')
  expect(list.status()).toBe(200)
  expect(await list.json()).toEqual([note])
})
