import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'
import { test, expect, type APIRequestContext } from '@playwright/test'
import fixtures from '../../../fixtures/leandro/LE-04/images.json'

const baseURL = process.env.LE04_TEST_BASE_URL
const databaseURL = process.env.LE04_TEST_DATABASE_URL
if (!baseURL || !databaseURL) throw new Error('LE-04 needs an explicitly isolated test server and database.')
if (![new URL(baseURL), new URL(databaseURL)].every(url => ['localhost', '127.0.0.1'].includes(url.hostname)) ||
    !new URL(databaseURL).pathname.endsWith('_test')) throw new Error('LE-04 refuses non-local or non-test targets.')
const pool = new Pool({ connectionString: databaseURL })
const companyId = randomUUID()
const userId = randomUUID()
const email = `le04-${userId}@example.test`
const password = randomBytes(24).toString('base64url')
let client: APIRequestContext

test.beforeAll(async ({ playwright }) => {
  await pool.query('INSERT INTO companies (id,name,email_domain) VALUES ($1,$2,$3)', [companyId, 'LE-04 synthetic', `${companyId}.test`])
  await pool.query('INSERT INTO users (id,company_id,name,email,password_hash) VALUES ($1,$2,$3,$4,$5)', [userId, companyId, 'Synthetic employee', email, await bcrypt.hash(password, 4)])
  client = await playwright.request.newContext({ baseURL })
  const { csrfToken } = await (await client.get('/api/auth/csrf')).json()
  const response = await client.post('/api/auth/callback/credentials', { form: { csrfToken, email, password, callbackUrl: `${baseURL}/expenses` }, maxRedirects: 0 })
  expect(response.status()).toBe(302)
  expect((await (await client.get('/api/auth/session')).json()).user.id).toBe(userId)
})
test.afterAll(async () => {
  await client?.dispose()
  await pool.query('DELETE FROM users WHERE id = $1', [userId])
  await pool.query('DELETE FROM companies WHERE id = $1', [companyId])
  await pool.end()
})

for (const fixture of fixtures) {
  test(`real authenticated OCR route: ${fixture.id}`, async () => {
    const response = await client.post('/api/expense-notes/receipt-suggestion', { multipart: {
      receipt: { name: `${fixture.id}.png`, mimeType: 'image/png', buffer: await readFile(path.join(process.cwd(), 'tests/fixtures/leandro/LE-04/images', `${fixture.id}.png`)) },
    } })
    expect(response.status()).toBe(200)
    expect(await response.json()).toEqual(fixture.expected)
    expect((await pool.query('SELECT count(*)::int AS count FROM expense_notes WHERE user_id=$1', [userId])).rows[0].count).toBe(0)
  })
}
