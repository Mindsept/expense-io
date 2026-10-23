import { randomBytes, randomUUID } from 'node:crypto'
import http from 'node:http'
import net from 'node:net'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { readTestTarget } from '../../../support/test-target'
import { spawnOwnedNodeProcess, stopOwnedNodeProcess } from '../../../support/process-tree.mjs'

// Guard every writable service before making a fixture or starting a child app.
readTestTarget()
const databaseURL = process.env.DATABASE_URL
const storageURL = process.env.S3_ENDPOINT && new URL(process.env.S3_ENDPOINT)
const bucket = process.env.S3_BUCKET
if (!databaseURL || !storageURL || !bucket || !process.env.AUTH_SECRET || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) throw new Error('LE-02 needs explicit common isolated database, storage and private authentication settings.')
if (![new URL(databaseURL), storageURL].every(url => ['127.0.0.1', 'localhost'].includes(url.hostname) && Number(url.port) >= 1024) || !new URL(databaseURL).pathname.endsWith('_test') || !bucket.endsWith('-test')) throw new Error('LE-02 refuses non-local/non-test services.')
const pool = new Pool({ connectionString: databaseURL })
const s3 = new S3Client({ endpoint: storageURL.href, region: process.env.S3_REGION ?? 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } })
const companyId = randomUUID()
const userId = randomUUID()
const password = randomBytes(24).toString('base64url')
const email = `${userId}@example.test`
const legacyId = randomUUID()
const legacyKey = `legacy-le02/${companyId}/1.png`
const rejectedDescription = `LE02_DBFAIL_${companyId}`
const constraint = `le02_reject_${companyId.replaceAll('-', '')}` // generated identifier, never client text
const png = readFileSync('tests/fixtures/leandro/LE-01/valid.png')
let client: APIRequestContext
let child: ReturnType<typeof spawnOwnedNodeProcess> | undefined
let baseURL: string
let failPuts = false
let failDeletes = false
let putGate: ReturnType<typeof gate> | undefined
const cleanupEvents: Array<Record<string, unknown>> = []
const storageCalls = { put: 0, remove: 0, putUnavailable: 0, removeUnavailable: 0 }

function gate() {
  let arrived!: () => void
  let release!: () => void
  return { written: new Promise<void>(resolve => { arrived = resolve }), released: new Promise<void>(resolve => { release = resolve }), arrive: () => arrived(), release: () => release() }
}
// A loopback HTTP fault boundary in front of real LocalStack. It can refuse a
// PUT/DELETE or delay only the acknowledgement after the real object is stored.
const proxy = http.createServer((request, response) => {
  if ((request.method === 'PUT' && failPuts) || (request.method === 'DELETE' && failDeletes)) {
    if (request.method === 'PUT') storageCalls.putUnavailable++
    else storageCalls.removeUnavailable++
    request.resume()
    response.writeHead(503, { 'Content-Type': 'application/xml' })
    response.end('<Error><Code>ServiceUnavailable</Code><Message>Synthetic LE-02 fault</Message></Error>')
    return
  }
  const outgoing = http.request({ hostname: storageURL.hostname, port: storageURL.port, path: request.url, method: request.method, headers: request.headers }, upstream => {
    const chunks: Buffer[] = []
    let size = 0
    upstream.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 1024 * 1024) { upstream.destroy(); response.destroy(); return }
      chunks.push(chunk)
    })
    upstream.on('error', () => response.destroy())
    upstream.on('end', () => {
      if (request.method === 'PUT' && upstream.statusCode === 200) storageCalls.put++
      if (request.method === 'DELETE' && upstream.statusCode === 204) storageCalls.remove++
      const send = () => { if (!response.destroyed) { response.writeHead(upstream.statusCode ?? 502, upstream.headers); response.end(Buffer.concat(chunks)) } }
      const currentGate = request.method === 'PUT' && upstream.statusCode === 200 ? putGate : undefined
      if (currentGate) { currentGate.arrive(); void currentGate.released.then(send) }
      else send()
    })
  })
  outgoing.on('error', () => { if (!response.destroyed) { response.writeHead(502); response.end() } })
  response.on('close', () => outgoing.destroy())
  request.pipe(outgoing)
})

async function unusedPort() {
  const reservation = net.createServer()
  await new Promise<void>((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve) })
  const port = (reservation.address() as net.AddressInfo).port
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()))
  return port
}
async function login() {
  const { csrfToken } = await (await client.get('/api/auth/csrf')).json()
  const response = await client.post('/api/auth/callback/credentials', { form: { csrfToken, email, password, callbackUrl: `${baseURL}/expenses` }, maxRedirects: 0 })
  expect(response.status()).toBe(302)
  expect((await (await client.get('/api/auth/session')).json()).user.id).toBe(userId)
}
async function state() {
  const notes = await pool.query('SELECT id,receipt_key FROM expense_notes WHERE user_id=$1 ORDER BY id', [userId])
  const objects = await s3.send(new ListObjectsV2Command({ Bucket: bucket }))
  expect(objects.IsTruncated).not.toBe(true)
  return { notes: notes.rows, keys: (objects.Contents ?? []).map(object => object.Key!).sort() }
}
function submit(description: string, requestId = randomUUID()) {
  return client.post('/api/expense-notes', { headers: { 'X-Request-Id': requestId }, multipart: { amount: '12.34', expenseDate: '2024-02-29', description, receipt: { name: 'untrusted-client-name.png', mimeType: 'image/png', buffer: png } } })
}
async function expectProblem(response: Awaited<ReturnType<typeof submit>>, status: number, requestId: string) {
  expect(response.status()).toBe(status)
  const body = await response.json()
  expect(body.status).toBe(status)
  expect(body.error).toBe(body.detail)
  expect(body.requestId).toBe(requestId)
  expect(response.headers()['x-request-id']).toBe(requestId)
  expect(JSON.stringify(body)).not.toMatch(new RegExp(`${password}|${companyId}|${userId}|${constraint}|X-Amz-`))
}

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(90_000)
  await pool.query('INSERT INTO companies (id,name,email_domain) VALUES ($1,$2,$3)', [companyId, 'LE-02 synthetic', `${companyId}.test`])
  await pool.query('INSERT INTO users (id,company_id,name,email,password_hash) VALUES ($1,$2,$3,$4,$5)', [userId, companyId, 'LE-02 employee', email, await bcrypt.hash(password, 4)])
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: legacyKey, Body: png, ContentType: 'image/png' }))
  await pool.query('INSERT INTO expense_notes (id,user_id,amount,expense_date,description,receipt_key) VALUES ($1,$2,12.34,$3,$4,$5)', [legacyId, userId, '2024-02-29', 'LE-02 legacy receipt', legacyKey])
  // Only a generated synthetic description fails; pre-existing rows are not scanned.
  await pool.query(`ALTER TABLE expense_notes ADD CONSTRAINT ${constraint} CHECK (description <> '${rejectedDescription}') NOT VALID`)
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))
  const proxyURL = `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`
  baseURL = `http://127.0.0.1:${await unusedPort()}`
  child = spawnOwnedNodeProcess([resolve('node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', new URL(baseURL).port], {
    env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: databaseURL, AUTH_URL: baseURL, AUTH_TRUST_HOST: 'true', S3_ENDPOINT: proxyURL, NEXT_TELEMETRY_DISABLED: '1' },
  })
  // Discard raw logs. Retain only parsed allowlisted cleanup events, with bounded
  // buffering/count, so a failing assertion cannot print SQL, cookies or URLs.
  let pending = ''
  const inspect = (chunk: Buffer) => {
    pending = (pending + chunk.toString()).slice(-16_384)
    const lines = pending.split('\n'); pending = lines.pop() ?? ''
    for (const line of lines) {
      try {
        const event = JSON.parse(line)
        if (event.operation === 'expense.submit.cleanup') {
          cleanupEvents.push(Object.fromEntries(['operation', 'code', 'receiptRef', 'extension', 'requestId'].map(key => [key, event[key]])))
          if (cleanupEvents.length > 100) cleanupEvents.shift()
        }
      } catch { /* Framework output is not a structured cleanup event. */ }
    }
  }
  child.stdout!.on('data', inspect); child.stderr!.on('data', inspect)
  await expect.poll(async () => {
    if (child?.exitCode !== null) throw new Error('LE-02 owned application exited before readiness.')
    try { return (await fetch(`${baseURL}/api/auth/csrf`, { signal: AbortSignal.timeout(1000) })).status }
    catch { return 0 }
  }, { timeout: 20_000 }).toBe(200)
  client = await playwright.request.newContext({ baseURL })
  await login()
})

test.afterAll(async () => {
  failPuts = false; failDeletes = false; putGate?.release()
  try {
    await client?.dispose()
    if (child) await stopOwnedNodeProcess(child)
    proxy.closeAllConnections()
    if (proxy.listening) await new Promise<void>((resolve, reject) => proxy.close(error => error ? reject(error) : resolve()))
    await pool.query(`ALTER TABLE expense_notes DROP CONSTRAINT IF EXISTS ${constraint}`)
    const receipts = await pool.query('SELECT receipt_key FROM expense_notes WHERE user_id=$1', [userId])
    for (const row of receipts.rows) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: row.receipt_key }))
    // Only references generated by this suite's private child app are eligible.
    for (const event of cleanupEvents) if (typeof event.receiptRef === 'string' && /^[0-9a-f-]{36}$/.test(event.receiptRef) && ['.png', '.jpg', '.webp', '.pdf'].includes(String(event.extension))) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: `receipts/${event.receiptRef}${event.extension}` }))
    await pool.query('DELETE FROM expense_notes WHERE user_id=$1', [userId])
    await pool.query('DELETE FROM users WHERE id=$1', [userId])
    await pool.query('DELETE FROM companies WHERE id=$1', [companyId])
  } finally { await pool.end(); s3.destroy() }
})

test('real upload creates one complete note, with opaque key and byte-for-byte signed download', async () => {
  const before = await state()
  const response = await submit('LE-02 complete submission')
  expect(response.status()).toBe(201)
  const note = await response.json()
  expect(note.userId).toBe(userId)
  expect(note.receiptKey).toMatch(/^receipts\/[0-9a-f-]{36}\.png$/)
  const after = await state()
  expect(after.notes).toHaveLength(before.notes.length + 1)
  expect(after.notes.every(row => row.receipt_key)).toBe(true)
  const stored = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: note.receiptKey }))
  expect(Buffer.from(await stored.Body!.transformToByteArray())).toEqual(png)
  const signed = await client.get(`/api/expense-notes/${note.id}/receipt-url`)
  expect(signed.status()).toBe(200)
  const download = await fetch((await signed.json()).url)
  expect(download.status).toBe(200)
  expect(Buffer.from(await download.arrayBuffer())).toEqual(png)
})

test('legacy receipt keys still sign and download unchanged', async () => {
  const response = await client.get(`/api/expense-notes/${legacyId}/receipt-url`)
  expect(response.status()).toBe(200)
  const downloaded = await fetch((await response.json()).url)
  expect(downloaded.status).toBe(200)
  expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(png)
})

test('injected S3 HTTP unavailability cannot create a final note or object', async () => {
  const before = await state()
  const unavailableBefore = storageCalls.putUnavailable
  const requestId = randomUUID()
  failPuts = true
  try {
    await expectProblem(await submit('LE-02 storage unavailable', requestId), 500, requestId)
    expect(await state()).toEqual(before)
    expect(storageCalls.putUnavailable).toBeGreaterThan(unavailableBefore)
    await expect.poll(() => cleanupEvents.some(event => event.requestId === requestId && event.code === 'upload_unconfirmed')).toBe(true)
  } finally { failPuts = false }
})

test('real PostgreSQL INSERT failure compensates the successful LocalStack upload', async () => {
  const before = await state()
  const putsBefore = storageCalls.put
  const removesBefore = storageCalls.remove
  const requestId = randomUUID()
  await expectProblem(await submit(rejectedDescription, requestId), 500, requestId)
  expect(await state()).toEqual(before)
  expect(storageCalls.put).toBe(putsBefore + 1)
  expect(storageCalls.remove).toBe(removesBefore + 1)
})

test('failed compensation retains only an actionable cleanup reference and preserves the public primary failure', async () => {
  const before = await state()
  const failuresBefore = storageCalls.removeUnavailable
  const requestId = randomUUID()
  failDeletes = true
  try {
    await expectProblem(await submit(rejectedDescription, requestId), 500, requestId)
    const after = await state()
    expect(after.notes).toEqual(before.notes)
    expect(storageCalls.removeUnavailable).toBeGreaterThan(failuresBefore)
    const orphan = after.keys.filter(key => !before.keys.includes(key))
    expect(orphan).toHaveLength(1)
    await expect.poll(() => cleanupEvents.find(event => event.requestId === requestId && event.code === 'cleanup_failed')).toBeTruthy()
    const event = cleanupEvents.find(event => event.requestId === requestId && event.code === 'cleanup_failed')!
    expect(`receipts/${event.receiptRef}${event.extension}`).toBe(orphan[0])
    expect(Object.keys(event).sort()).toEqual(['operation', 'code', 'receiptRef', 'extension', 'requestId'].sort())
    expect(JSON.stringify(event)).not.toMatch(new RegExp(`${password}|${userId}|${companyId}|${rejectedDescription}|X-Amz-|untrusted-client-name`))
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: orphan[0] }))
  } finally { failDeletes = false }
  expect(await state()).toEqual(before)
})

test('revocation after real S3 write rechecks the actor, compensates, and holds no DB lock during upload', async () => {
  const before = await state()
  const requestId = randomUUID()
  const barrier = gate(); putGate = barrier
  const response = submit('LE-02 revoked during upload', requestId)
  try {
    await Promise.race([barrier.written, response.then(() => { throw new Error('Submission returned before the gated upload acknowledgement.') })])
    const duringUpload = await state()
    expect(duringUpload.notes).toEqual(before.notes)
    expect(duringUpload.keys.filter(key => !before.keys.includes(key))).toHaveLength(1)
    const writer = await pool.connect()
    try {
      await writer.query('BEGIN')
      await writer.query("SET LOCAL statement_timeout = '2000ms'")
      await writer.query('UPDATE users SET is_active=false WHERE id=$1', [userId])
      await writer.query('COMMIT')
    } finally { await writer.query('ROLLBACK'); writer.release() }
    barrier.release()
    await expectProblem(await response, 401, requestId)
    expect(await state()).toEqual(before)
  } finally {
    barrier.release(); putGate = undefined
    await response.catch(() => {})
    await pool.query('UPDATE users SET is_active=true WHERE id=$1', [userId])
    await login()
  }
})
