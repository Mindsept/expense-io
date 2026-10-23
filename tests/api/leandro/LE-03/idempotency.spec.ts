import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import bcrypt from 'bcryptjs'
import { Pool, escapeLiteral } from 'pg'
import { DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { readTestIdentity, readTestTarget } from '../../../support/test-target'
import { IntentHttpHarness } from '../../../contracts/leandro/LE-03/http-harness'
import { assertResponse } from '../../../contracts/leandro/LE-10/openapi'

readTestTarget()
const databaseURL = process.env.DATABASE_URL
const storageURL = process.env.S3_ENDPOINT && new URL(process.env.S3_ENDPOINT)
const bucket = process.env.S3_BUCKET
if (!databaseURL || !storageURL || !bucket || !process.env.AUTH_SECRET || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) throw new Error('LE-03 requires the explicit shared isolated database, storage and authentication settings.')
if (![new URL(databaseURL), storageURL].every(url => ['127.0.0.1', 'localhost'].includes(url.hostname) && Number(url.port) >= 1024) || !new URL(databaseURL).pathname.endsWith('_test') || !bucket.endsWith('-test')) throw new Error('LE-03 refuses nonlocal/non-test services.')
const storageEndpoint = storageURL.href
// Reuse an explicitly private, CI-redacted disposable credential, never a public default.
const password = readTestIdentity('EMPLOYEE').password
const pool = new Pool({ connectionString: databaseURL })
const s3 = new S3Client({ endpoint: storageURL.href, region: process.env.S3_REGION ?? 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } })
const companies = { a: randomUUID(), b: randomUUID() }
const users = { a: randomUUID(), b: randomUUID(), deleted: randomUUID() }
const harness = new IntentHttpHarness(storageURL)
const clients: Record<string, APIRequestContext> = {}
const png = readFileSync('tests/fixtures/leandro/LE-01/valid.png')
const otherPng = readFileSync('tests/fixtures/leandro/LE-04/images/leap-day.png')
const syntheticPrefix = `LE-03 ${randomUUID()}`
const temporaryConstraints = new Set<string>()
const extraObjects = new Set<string>()
let limited: Pool | undefined
let roleCreated = false
const role = `le03_registry_${randomUUID().replaceAll('-', '')}`

async function login(context: APIRequestContext, userId: string) {
  const { csrfToken } = await (await context.get('/api/auth/csrf')).json()
  const response = await context.post('/api/auth/callback/credentials', { form: { csrfToken, email: `${userId}@example.test`, password }, maxRedirects: 0 })
  expect(response.status()).toBe(302)
  expect((await (await context.get('/api/auth/session')).json()).user.id).toBe(userId)
}
function submit(context: APIRequestContext, key: string, description: string, options: { amount?: string; buffer?: Buffer; filename?: string } = {}) {
  return context.post('/api/expense-notes', { maxRetries: 0, headers: { 'Idempotency-Key': key }, multipart: {
    amount: options.amount ?? '12.30', expenseDate: '2024-02-29', description,
    receipt: { name: options.filename ?? 'synthetic.png', mimeType: 'image/png', buffer: options.buffer ?? png },
  } })
}
async function body(response: APIResponse, status: number) {
  expect(response.status()).toBe(status)
  const result = await response.json()
  assertResponse('/api/expense-notes', 'post', status, response.headers(), result)
  return result
}
async function problem(response: APIResponse, code: string) {
  const result = await body(response, code === 'unauthenticated' ? 401 : 'idempotency_conflict idempotency_in_progress idempotency_expired'.includes(code) ? 409 : code === 'validation' ? 400 : 500)
  expect(result.type).toBe(`urn:expense-io:problem:${code}`)
  expect(JSON.stringify(result)).not.toMatch(new RegExp(`${password}|${users.a}|${users.b}|${companies.a}|${companies.b}|X-Amz-|${syntheticPrefix}`))
}
async function objectKeys() {
  const objects = await s3.send(new ListObjectsV2Command({ Bucket: bucket }))
  expect(objects.IsTruncated).not.toBe(true)
  return (objects.Contents ?? []).map(object => object.Key!).sort()
}
async function operation(key: string, owner = users.a, company = companies.a) {
  const result = await pool.query('SELECT * FROM expense_submission_operations WHERE intent_key=$1 AND user_id=$2 AND company_id=$3', [key, owner, company])
  expect(result.rows).toHaveLength(1)
  return result.rows[0]
}
async function ageAttempt(attemptId: string) {
  await pool.query("UPDATE expense_submission_attempts SET created_at=clock_timestamp()-interval '10 minutes' WHERE id=$1", [attemptId])
  await pool.query("UPDATE expense_submission_operations SET lease_until=clock_timestamp()-interval '5 minutes' WHERE current_attempt_id=$1 AND state='processing'", [attemptId])
}
async function reconcile(companyId: string, apply = false, options: { limit?: number; endpoint?: string } = {}) {
  // A separate process executes the actual private command. Its output contains
  // only bounded cleanup references/codes; stderr and credentials are not echoed.
  const args = ['scripts/leandro/LE-03/reconcile.mjs', '--company-id', companyId, apply ? '--apply' : '--dry-run']
  if (options.limit !== undefined) args.push('--limit', String(options.limit))
  const env: NodeJS.ProcessEnv = { ...process.env, LE03_MAINTENANCE_DATABASE_URL: databaseURL, S3_ENDPOINT: options.endpoint ?? storageEndpoint, NO_COLOR: '1' }
  delete env.FORCE_COLOR // Playwright can otherwise inherit conflicting Node color flags.
  const result = spawnSync(process.execPath, args, { env, encoding: 'utf8', timeout: 40_000, maxBuffer: 128 * 1024 })
  expect(result.error).toBeUndefined()
  expect(result.stderr).toBe('')
  return { code: result.status, result: JSON.parse(result.stdout) as { mode: string; scanned: number; processed: number; items: Array<{ receiptRef: string; status: string }> } }
}

async function abandonedFixture(companyId: string, userId: string, ageMinutes = 10) {
  const id = randomUUID(), attempt = randomUUID(), key = `receipts/${attempt}.png`
  extraObjects.add(key)
  await pool.query('INSERT INTO expense_submission_operations (id,user_id,company_id,intent_key,fingerprint) VALUES ($1,$2,$3,$4,$5)', [id, userId, companyId, randomUUID(), 'a'.repeat(64)])
  await pool.query(`INSERT INTO expense_submission_attempts (id,operation_id,user_id,company_id,extension,receipt_key,created_at)
    VALUES ($1,$2,$3,$4,'.png',$5,clock_timestamp()-($6::double precision*interval '1 minute'))`, [attempt, id, userId, companyId, key, ageMinutes])
  // Default failed/null pointer means this attempt has no right to create a note.
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: png, ContentType: 'image/png' }))
  return { id, attempt, key }
}

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(90_000)
  for (const id of Object.values(companies)) await pool.query('INSERT INTO companies (id,name,email_domain) VALUES ($1,$2,$3)', [id, 'LE-03 synthetic', `${id}.test`])
  const hash = await bcrypt.hash(password, 4)
  for (const [name, id] of Object.entries(users)) await pool.query('INSERT INTO users (id,company_id,name,email,password_hash) VALUES ($1,$2,$3,$4,$5)', [id, name === 'b' ? companies.b : companies.a, `LE-03 ${name}`, `${id}@example.test`, hash])
  await harness.start()
  for (const [name, url, id] of [['a', harness.urls[0], users.a], ['second', harness.urls[1], users.a], ['b', harness.urls[1], users.b], ['deleted', harness.urls[1], users.deleted], ['loss', harness.lossURL, users.a]]) {
    clients[name] = await playwright.request.newContext({ baseURL: url })
    await login(clients[name], id)
  }
})

test.afterAll(async () => {
  await Promise.all(Object.values(clients).map(context => context.dispose()))
  await harness.stop()
  await limited?.end()
  try {
    for (const constraint of temporaryConstraints) await pool.query(`ALTER TABLE expense_submission_operations DROP CONSTRAINT IF EXISTS ${constraint}`)
    const attempts = await pool.query('SELECT receipt_key FROM expense_submission_attempts WHERE user_id=ANY($1::uuid[])', [Object.values(users)])
    for (const row of attempts.rows) extraObjects.add(row.receipt_key)
    for (const key of extraObjects) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    // Break only this suite's pointer edges before deleting its registry, then notes/users.
    await pool.query("UPDATE expense_submission_operations SET state='failed',current_attempt_id=NULL,lease_until=NULL,note_id=NULL,result=NULL WHERE user_id=ANY($1::uuid[])", [Object.values(users)])
    await pool.query('DELETE FROM expense_submission_attempts WHERE user_id=ANY($1::uuid[])', [Object.values(users)])
    await pool.query('DELETE FROM expense_submission_operations WHERE user_id=ANY($1::uuid[])', [Object.values(users)])
    await pool.query('DELETE FROM expense_notes WHERE user_id=ANY($1::uuid[])', [Object.values(users)])
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [Object.values(users)])
    await pool.query('DELETE FROM companies WHERE id=ANY($1::uuid[])', [Object.values(companies)])
    if (roleCreated) {
      await pool.query(`DROP OWNED BY ${role}`)
      await pool.query(`DROP ROLE ${role}`)
    }
  } finally { await pool.end(); s3.destroy() }
})

test('two production processes coordinate a concurrent intent through PostgreSQL, then replay exactly without another upload', async () => {
  const key = randomUUID(), description = `${syntheticPrefix} concurrent`
  const puts = harness.calls.put
  const gate = harness.holdNextPut()
  const first = submit(clients.a, key, description)
  try {
    await Promise.race([gate.written, first.then(() => { throw new Error('First request ended before held PUT') })])
    await problem(await submit(clients.second, key, description), 'idempotency_in_progress')
    expect(harness.calls.put).toBe(puts + 1)
    gate.release()
    const response = await first
    const created = await body(response, 201)
    expect(response.headers()['idempotency-replayed']).toBe('false')
    const replay = await submit(clients.second, key, description)
    expect(await body(replay, 201)).toEqual(created)
    expect(replay.headers()['idempotency-replayed']).toBe('true')
    expect(harness.calls.put).toBe(puts + 1)
    expect((await pool.query('SELECT id FROM expense_notes WHERE user_id=$1 AND description=$2', [users.a, description])).rows).toHaveLength(1)
    expect((await operation(key)).state).toBe('completed')
  } finally { gate.release(); await first.catch(() => {}) }
})

test('a lost HTTP 201 response recovers the durable result without a second note or business upload', async () => {
  const key = randomUUID(), description = `${syntheticPrefix} lost response`
  const puts = harness.calls.put
  harness.loseNextPost = true
  await expect(submit(clients.loss, key, description)).rejects.toThrow()
  expect(harness.calls.lostStatus).toBe(201)
  const stored = await operation(key)
  expect(stored.state).toBe('completed')
  const replay = await submit(clients.second, key, description)
  expect(await body(replay, 201)).toEqual(stored.result)
  expect(replay.headers()['idempotency-replayed']).toBe('true')
  expect(harness.calls.put).toBe(puts + 1)
  expect((await pool.query('SELECT count(*)::int AS n FROM expense_notes WHERE user_id=$1 AND description=$2', [users.a, description])).rows[0].n).toBe(1)
})

test('payload conflict preserves the first note; equivalent decimals and changed filenames replay it', async () => {
  const key = randomUUID(), description = `${syntheticPrefix} fingerprint`
  const created = await body(await submit(clients.a, key, description), 201)
  const puts = harness.calls.put
  await problem(await submit(clients.second, key, description, { amount: '12.31' }), 'idempotency_conflict')
  await problem(await submit(clients.second, key, description, { buffer: otherPng }), 'idempotency_conflict')
  const replay = await submit(clients.second, key, `  ${description}  `, { amount: '00012.3', filename: 'renamed.png' })
  expect(await body(replay, 201)).toEqual(created)
  expect(harness.calls.put).toBe(puts)
  expect((await operation(key)).result).toEqual(created)
})

test('the same UUID in another user/company is independent and never shares its cached note', async () => {
  const key = randomUUID(), description = `${syntheticPrefix} independent`
  const first = await body(await submit(clients.a, key, description), 201)
  const other = await body(await submit(clients.b, key, description), 201)
  expect(first.userId).toBe(users.a); expect(other.userId).toBe(users.b)
  expect(other.id).not.toBe(first.id)
  expect((await operation(key, users.b, companies.b)).result).toEqual(other)
})

test('revoked/deleted genuine sessions cannot recover a cached result or start a keyed upload', async () => {
  const key = randomUUID(), description = `${syntheticPrefix} revoked`
  await body(await submit(clients.a, key, description), 201)
  const puts = harness.calls.put
  try {
    await pool.query('UPDATE users SET is_active=false WHERE id=$1', [users.a])
    await problem(await submit(clients.second, key, description), 'unauthenticated')
    expect(harness.calls.put).toBe(puts)
  } finally { await pool.query('UPDATE users SET is_active=true WHERE id=$1', [users.a]); await login(clients.a, users.a); await login(clients.second, users.a) }
  await pool.query('DELETE FROM users WHERE id=$1', [users.deleted])
  await problem(await submit(clients.deleted, key, description), 'unauthenticated')
  expect(harness.calls.put).toBe(puts)
})

test('a company change applies the new scope to an old signed session and cannot replay the old company result', async () => {
  const key = randomUUID(), description = `${syntheticPrefix} company change`
  const first = await body(await submit(clients.a, key, description), 201)
  try {
    await pool.query('UPDATE users SET company_id=$1 WHERE id=$2', [companies.b, users.a])
    const second = await body(await submit(clients.second, key, description), 201)
    expect(second.id).not.toBe(first.id)
    expect(second.userId).toBe(users.a)
    expect((await operation(key, users.a, companies.b)).result).toEqual(second)
    expect((await operation(key)).result).toEqual(first)
  } finally { await pool.query('UPDATE users SET company_id=$1 WHERE id=$2', [companies.a, users.a]) }
})

test('an expired key never creates another mutation and malformed/repeated keys are 400', async () => {
  const key = randomUUID(), description = `${syntheticPrefix} expiry`
  await body(await submit(clients.a, key, description), 201)
  await pool.query("UPDATE expense_submission_operations SET expires_at=clock_timestamp()-interval '1 second' WHERE intent_key=$1 AND user_id=$2", [key, users.a])
  const puts = harness.calls.put
  await problem(await submit(clients.second, key, description), 'idempotency_expired')
  for (const invalid of ['', 'constructor', `${key},${key}`]) await problem(await submit(clients.a, invalid, description), 'validation')
  expect(harness.calls.put).toBe(puts)
})

test('note and cache roll back together; failed cleanup is durable and a retry uses a different receipt attempt', async () => {
  const key = randomUUID(), description = `${syntheticPrefix} atomic cache`
  const constraint = `le03_cache_${key.replaceAll('-', '')}`
  temporaryConstraints.add(constraint)
  await pool.query(`ALTER TABLE expense_submission_operations ADD CONSTRAINT ${constraint} CHECK (intent_key <> '${key}'::uuid OR state <> 'completed') NOT VALID`)
  const before = await objectKeys()
  harness.failDeletes = true
  try {
    await problem(await submit(clients.a, key, description), 'technical_failure')
  } finally { harness.failDeletes = false; await pool.query(`ALTER TABLE expense_submission_operations DROP CONSTRAINT ${constraint}`); temporaryConstraints.delete(constraint) }
  const failed = await operation(key)
  expect(failed.state).toBe('failed'); expect(failed.result).toBeNull(); expect(failed.note_id).toBeNull()
  expect((await pool.query('SELECT id FROM expense_notes WHERE user_id=$1 AND description=$2', [users.a, description])).rows).toHaveLength(0)
  const attempts = await pool.query('SELECT * FROM expense_submission_attempts WHERE operation_id=$1', [failed.id])
  expect(attempts.rows).toHaveLength(1)
  const old = attempts.rows[0]
  expect(old.state).toBe('retired')
  expect((await objectKeys()).filter(key => !before.includes(key))).toEqual([old.receipt_key])
  const created = await body(await submit(clients.second, key, description), 201)
  expect(created.receiptKey).not.toBe(old.receipt_key)
  await ageAttempt(old.id)
  const dry = await reconcile(companies.a)
  expect(dry.code).toBe(0); expect(dry.result.mode).toBe('dry-run')
  expect(dry.result.items).toContainEqual(expect.objectContaining({ receiptRef: old.id, status: 'would_delete' }))
  expect(await objectKeys()).toContain(old.receipt_key)
  const applied = await reconcile(companies.a, true)
  expect(applied.code).toBe(0)
  expect(applied.result.items).toContainEqual(expect.objectContaining({ receiptRef: old.id, status: 'deleted' }))
  expect(await objectKeys()).not.toContain(old.receipt_key)
  expect(await objectKeys()).toContain(created.receiptKey)
})

test('bounded reconciliation respects age, scope, referenced receipts and retryable deletion failure', async () => {
  const old = await abandonedFixture(companies.a, users.a, 15)
  const recent = await abandonedFixture(companies.a, users.a, 1)
  const foreign = await abandonedFixture(companies.b, users.b, 20)
  const referenced = await abandonedFixture(companies.a, users.a, 12)
  await pool.query('INSERT INTO expense_notes(user_id,amount,expense_date,description,receipt_key) VALUES($1,12.30,$2,$3,$4)', [users.a, '2024-02-29', `${syntheticPrefix} retained reference`, referenced.key])
  const before = await objectKeys()
  const rowsBefore = await pool.query('SELECT state,current_attempt_id FROM expense_submission_operations WHERE id=$1', [old.id])
  const dry = await reconcile(companies.a, false, { limit: 1 })
  expect(dry.code).toBe(0); expect(dry.result.scanned).toBeLessThanOrEqual(1)
  expect(await objectKeys()).toEqual(before)
  expect((await pool.query('SELECT state,current_attempt_id FROM expense_submission_operations WHERE id=$1', [old.id])).rows).toEqual(rowsBefore.rows)
  const failed = await reconcile(companies.a, true, { limit: 1, endpoint: 'http://127.0.0.1:1' })
  expect(failed.code).toBe(1)
  expect(failed.result.items).toContainEqual(expect.objectContaining({ receiptRef: old.attempt, status: 'cleanup_failed' }))
  expect(await objectKeys()).toContain(old.key)
  const applied = await reconcile(companies.a, true)
  expect(applied.code).toBe(0)
  expect(await objectKeys()).not.toContain(old.key)
  expect(await objectKeys()).toContain(recent.key)
  expect(await objectKeys()).toContain(foreign.key)
  expect(await objectKeys()).toContain(referenced.key)
  expect(applied.result.items).toContainEqual(expect.objectContaining({ receiptRef: referenced.attempt, status: 'referenced' }))
  const row = await pool.query('SELECT state,cleanup_result FROM expense_submission_attempts WHERE id=$1', [old.attempt])
  expect(row.rows).toEqual([{ state: 'retired', cleanup_result: 'deleted' }])
})

test('a real limited login enforces registry owner/company/active policies and rejects missing context and forbidden new values', async () => {
  const intent = randomUUID()
  await body(await submit(clients.a, intent, `${syntheticPrefix} RLS own`), 201)
  const foreignNote = await body(await submit(clients.b, intent, `${syntheticPrefix} RLS foreign`), 201)
  // A retained record for the same owner in another company isolates the
  // company predicate from the independently tested owner predicate.
  await pool.query('INSERT INTO expense_submission_operations(user_id,company_id,intent_key,fingerprint) VALUES($1,$2,$3,$4)', [users.a, companies.b, randomUUID(), 'b'.repeat(64)])
  await pool.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD ${escapeLiteral(password)}`)
  roleCreated = true
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${role}`)
  await pool.query(`GRANT SELECT(id,company_id,is_active) ON users TO ${role}`)
  await pool.query(`GRANT SELECT,INSERT,UPDATE ON expense_submission_operations,expense_submission_attempts TO ${role}`)
  const connection = new URL(databaseURL!); connection.username = role; connection.password = password
  limited = new Pool({ connectionString: connection.href, max: 1 })
  const client = await limited.connect()
  try {
    const identity = await client.query('SELECT current_user,session_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')
    expect(identity.rows).toEqual([{ current_user: role, session_user: role, rolsuper: false, rolbypassrls: false }])
    expect((await client.query('SELECT id FROM expense_submission_operations')).rows).toEqual([])
    await client.query('BEGIN'); await client.query("SELECT set_config('app.current_user_id',$1,true)", [users.a])
    const owned = await client.query('SELECT user_id,company_id FROM expense_submission_operations')
    expect(owned.rows.length).toBeGreaterThan(0)
    expect(owned.rows.every(row => row.user_id === users.a && row.company_id === companies.a)).toBe(true)
    const attempts = await client.query('SELECT user_id,company_id FROM expense_submission_attempts')
    expect(attempts.rows.length).toBeGreaterThan(0)
    expect(attempts.rows.every(row => row.user_id === users.a && row.company_id === companies.a)).toBe(true)
    const ownReservation = await client.query('INSERT INTO expense_submission_operations(user_id,company_id,intent_key,fingerprint) VALUES($1,$2,$3,$4) RETURNING id', [users.a, companies.a, randomUUID(), 'c'.repeat(64)])
    const ownedAttempt = randomUUID()
    await client.query("INSERT INTO expense_submission_attempts(id,operation_id,user_id,company_id,extension,receipt_key) VALUES($1,$2,$3,$4,'.png',$5)", [ownedAttempt, ownReservation.rows[0].id, users.a, companies.a, `receipts/${ownedAttempt}.png`])
    expect((await client.query("UPDATE expense_submission_operations SET state='processing',current_attempt_id=$2,lease_until=clock_timestamp()+interval '2 minutes' WHERE id=$1 RETURNING id", [ownReservation.rows[0].id, ownedAttempt])).rows).toHaveLength(1)
    expect((await client.query('UPDATE expense_submission_operations SET updated_at=clock_timestamp() WHERE user_id=$1 RETURNING id', [users.b])).rows).toEqual([])
    expect((await operation(intent, users.b, companies.b)).result).toEqual(foreignNote)
    expect((await client.query("SELECT has_table_privilege(current_user,'expense_submission_operations','DELETE') AS can_delete,has_table_privilege(current_user,'expense_submission_attempts','TRUNCATE') AS can_truncate")).rows).toEqual([{ can_delete: false, can_truncate: false }])
    await client.query('SAVEPOINT denied')
    await expect(client.query('INSERT INTO expense_submission_operations(user_id,company_id,intent_key,fingerprint) VALUES ($1,$2,$3,$4)', [users.b, companies.b, randomUUID(), 'a'.repeat(64)])).rejects.toMatchObject({ code: '42501' })
    await client.query('ROLLBACK TO SAVEPOINT denied')
    await expect(client.query('UPDATE expense_submission_operations SET company_id=$1 WHERE user_id=$2', [companies.b, users.a])).rejects.toMatchObject({ code: '42501' })
    await client.query('ROLLBACK TO SAVEPOINT denied')
    await client.query('COMMIT')
    expect((await client.query('SELECT id FROM expense_submission_operations')).rows).toEqual([])
    await expect(client.query('INSERT INTO expense_submission_operations(user_id,company_id,intent_key,fingerprint) VALUES($1,$2,$3,$4)', [users.a, companies.a, randomUUID(), 'd'.repeat(64)])).rejects.toMatchObject({ code: '42501' })
    await pool.query('UPDATE users SET is_active=false WHERE id=$1', [users.a])
    await client.query('BEGIN'); await client.query("SELECT set_config('app.current_user_id',$1,true)", [users.a])
    expect((await client.query('SELECT id FROM expense_submission_operations')).rows).toEqual([])
    await expect(client.query('INSERT INTO expense_submission_operations(user_id,company_id,intent_key,fingerprint) VALUES($1,$2,$3,$4)', [users.a, companies.a, randomUUID(), 'e'.repeat(64)])).rejects.toMatchObject({ code: '42501' })
    await client.query('ROLLBACK')
  } finally { await client.query('ROLLBACK'); client.release(); await pool.query('UPDATE users SET is_active=true WHERE id=$1', [users.a]) }
})

test('migration upgrade/down/upgrade preserves existing base records in a disposable schema', async () => {
  const schema = `le03_upgrade_${randomUUID().replaceAll('-', '')}`
  const sql = readFileSync('migrations/1792749600000_leandro_expense_submission_registry.sql', 'utf8')
  const [up, down] = sql.split('-- Down Migration')
  const client = await pool.connect()
  try {
    await client.query(`CREATE SCHEMA ${schema}`)
    await client.query('BEGIN'); await client.query(`SET LOCAL search_path TO ${schema},public`)
    await client.query('CREATE TABLE companies(id uuid PRIMARY KEY); CREATE TABLE users(id uuid PRIMARY KEY,company_id uuid,is_active boolean); CREATE TABLE expense_notes(id uuid PRIMARY KEY,receipt_key text);')
    await client.query('INSERT INTO companies VALUES($1)', [companies.a])
    await client.query('INSERT INTO users VALUES($1,$2,true)', [users.a, companies.a])
    await client.query('INSERT INTO expense_notes VALUES($1,$2)', [randomUUID(), 'legacy.png'])
    await client.query(up); await client.query(down); await client.query(up)
    expect((await client.query('SELECT receipt_key FROM expense_notes')).rows).toEqual([{ receipt_key: 'legacy.png' }])
    await client.query('COMMIT')
  } finally { await client.query('ROLLBACK'); await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); client.release() }
})

test('retiring a stale in-flight attempt fences its late handler and cleanup cannot delete a later committed receipt', async () => {
  const key = randomUUID(), description = `${syntheticPrefix} fence late upload`
  const gate = harness.holdNextPut()
  const first = submit(clients.a, key, description)
  try {
    await Promise.race([gate.written, first.then(() => { throw new Error('First request ended before held PUT') })])
    const pending = await operation(key)
    const old = (await pool.query('SELECT * FROM expense_submission_attempts WHERE id=$1', [pending.current_attempt_id])).rows[0]
    await ageAttempt(old.id)
    const cleaned = await reconcile(companies.a, true)
    expect(cleaned.code).toBe(0)
    expect(await objectKeys()).not.toContain(old.receipt_key)
    const winner = await body(await submit(clients.second, key, description), 201)
    expect(winner.receiptKey).not.toBe(old.receipt_key)
    gate.release()
    await problem(await first, 'idempotency_in_progress')
    expect(await objectKeys()).toContain(winner.receiptKey)
    expect((await operation(key)).result).toEqual(winner)
    expect((await pool.query('SELECT count(*)::int AS n FROM expense_notes WHERE user_id=$1 AND description=$2', [users.a, description])).rows[0].n).toBe(1)
  } finally { gate.release(); await first.catch(() => {}) }
})

test('process death after a real upload leaves a durable reference which simulation preserves and apply cleans', async () => {
  const key = randomUUID(), description = `${syntheticPrefix} crash`
  const gate = harness.holdNextPut()
  const pendingResponse = submit(clients.a, key, description)
  // Attach rejection handling before killing the owned process.
  const observed = pendingResponse.catch(() => undefined)
  try {
    await gate.written
    const pending = await operation(key)
    const attempt = (await pool.query('SELECT * FROM expense_submission_attempts WHERE id=$1', [pending.current_attempt_id])).rows[0]
    await harness.stopApp(0)
    await observed
    gate.release()
    await ageAttempt(attempt.id)
    expect(await objectKeys()).toContain(attempt.receipt_key)
    expect((await pool.query('SELECT id FROM expense_notes WHERE user_id=$1 AND description=$2', [users.a, description])).rows).toEqual([])
    const dry = await reconcile(companies.a)
    expect(dry.code).toBe(0); expect(await objectKeys()).toContain(attempt.receipt_key)
    expect(dry.result.items).toContainEqual(expect.objectContaining({ receiptRef: attempt.id, status: 'would_delete' }))
    const applied = await reconcile(companies.a, true)
    expect(applied.code).toBe(0); expect(await objectKeys()).not.toContain(attempt.receipt_key)
  } finally { gate.release(); await observed }
})
