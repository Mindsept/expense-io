import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { mkdtemp, readdir, copyFile, rm } from 'node:fs/promises'
import os from 'node:os'
import { runner } from 'node-pg-migrate'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'
import { expect, test } from '@playwright/test'
import { bootstrapCompany as bootstrapAdministrator } from '../../../../proposals/HA-05/bootstrap-company.mjs'
import { createInvitationToken, issueEmployeeInvitation, redeemInvitation, revokeEmployeeInvitation } from '../../../../proposals/HA-05/invitation-enrollment'

// SQL-only integration proof of the draft primitive; no HTTP route is changed.
const databaseURL = process.env.HA05_TEST_DATABASE_URL
if (!databaseURL) throw new Error('Set HA05_TEST_DATABASE_URL to a disposable loopback PostgreSQL *_test database.')
const database = new URL(databaseURL)
if (!['postgres:', 'postgresql:'].includes(database.protocol) || !['127.0.0.1', 'localhost'].includes(database.hostname) || !database.pathname.endsWith('_test')) {
  throw new Error('HA-05 refuses a database outside loopback or without the _test suffix.')
}
const schema = `ha05_${randomUUID().replaceAll('-', '')}`
const maintenance = new Pool({ connectionString: databaseURL })
const pool = new Pool({ connectionString: databaseURL, options: `-c search_path=${schema},public`, application_name: schema, max: 5 })
function bootstrapCompany(target: Pick<Pool, 'connect'>, input: ReturnType<typeof bootstrapInput>) {
  return bootstrapAdministrator(target, input, { schemaName: schema })
}
let schemaCreated = false
let companyId: string
const issuerId = randomUUID()

test.beforeAll(async () => {
  // Isolate this suite even from other suites in the designated test database.
  await maintenance.query(`CREATE SCHEMA ${schema}`)
  schemaCreated = true
  // PostgreSQL 16 supplies gen_random_uuid natively. Avoid installing a global
  // extension while constructing this suite's private copy of the tables.
  const initial = readFileSync(resolve('migrations/1700000000001_init-schema.sql'), 'utf8')
    .split('-- Down Migration')[0].replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', '')
  await pool.query(initial)
  await pool.query(readFileSync(resolve('migrations/1792583999000_hamza_current-account.sql'), 'utf8').split('-- Down Migration')[0])
  await pool.query(readFileSync(resolve('proposals/HA-05/invitation-schema.sql'), 'utf8'))
  companyId = (await pool.query('INSERT INTO companies (name, email_domain) VALUES ($1, $2) RETURNING id', ['HA-05 proposal test', `${randomUUID()}.test`])).rows[0].id
  await pool.query("INSERT INTO users (id, company_id, name, email, password_hash, role) VALUES ($1,$2,'Issuer',$3,'unused','hr_admin')", [issuerId, companyId, `${issuerId}@example.test`])
})

test.afterAll(async () => {
  await pool.end()
  if (schemaCreated) await maintenance.query(`DROP SCHEMA ${schema} CASCADE`)
  await maintenance.end()
})

async function invitation(email: string, expires = '1 hour', revoked = false) {
  const capability = createInvitationToken()
  const row = await pool.query(
    `INSERT INTO enrollment_invitations (token_sha256, company_id, intended_email, invited_role, created_at, expires_at, revoked_at, issued_by)
     VALUES ($1, $2, $3, 'employee', clock_timestamp() - interval '2 days', clock_timestamp() + $4::interval, CASE WHEN $5 THEN clock_timestamp() ELSE NULL END, $6)
     RETURNING id`,
    [capability.tokenSha256, companyId, email, expires, revoked, issuerId],
  )
  return { ...capability, id: row.rows[0].id }
}

function account(token: string, verifiedEmail: string) {
  return { token, verifiedEmail, name: ' Invited person ', password: randomBytes(24).toString('base64url') }
}

async function unused(id: string) {
  const row = (await pool.query('SELECT consumed_at, consumed_by FROM enrollment_invitations WHERE id = $1', [id])).rows[0]
  expect(row.consumed_at).toBeNull()
  expect(row.consumed_by).toBeNull()
}

test('creates one employee in the explicit company and stores a password hash, never a token', async () => {
  const email = `${randomUUID()}@unrelated-public-domain.test`
  const invite = await invitation(email)
  const input = account(invite.token, email)
  const result = await redeemInvitation(pool, input)
  expect(result).toMatchObject({ kind: 'account_created', companyId, next: 'sign_in' })
  const user = (await pool.query('SELECT company_id, role, name, password_hash FROM users WHERE id = $1', [result.userId])).rows[0]
  expect(user.company_id).toBe(companyId)
  expect(user.role).toBe('employee')
  expect(user.name).toBe('Invited person')
  expect(await bcrypt.compare(input.password, user.password_hash)).toBe(true)
  expect(user.password_hash === input.password).toBe(false)
  const stored = (await pool.query('SELECT * FROM enrollment_invitations WHERE id = $1', [invite.id])).rows[0]
  expect(stored.consumed_by).toBe(result.userId)
  expect(stored.consumed_at).not.toBeNull()
  expect(JSON.stringify(stored).includes(invite.token)).toBe(false)
})

test('PO-01: an active HR issues a company/email-bound invitation with a private single-use capability', async () => {
  const email = `${randomUUID()}@example.test`
  const issued = await issueEmployeeInvitation(pool, issuerId, { email, ttlSeconds: 3600 })
  expect(issued.companyId).toBe(companyId)
  const stored = (await pool.query('SELECT * FROM enrollment_invitations WHERE id=$1', [issued.invitationId])).rows[0]
  expect(stored).toMatchObject({ issued_by: issuerId, company_id: companyId, intended_email: email, invited_role: 'employee' })
  expect(JSON.stringify(stored)).not.toContain(issued.token)
  expect(Math.round((stored.expires_at - stored.created_at) / 1000)).toBe(3600)
  expect((await redeemInvitation(pool, account(issued.token, email))).companyId).toBe(companyId)
})

test('PO-01: a disabled or demoted issuer cannot use its old HR identity', async () => {
  const before = (await pool.query('SELECT count(*) FROM enrollment_invitations')).rows[0].count
  try {
    await pool.query('UPDATE users SET is_active=false WHERE id=$1', [issuerId])
    await expect(issueEmployeeInvitation(pool, issuerId, { email: 'person@example.test', ttlSeconds: 3600 })).rejects.toMatchObject({ code: 'issuer_forbidden' })
    await pool.query("UPDATE users SET is_active=true, role='employee' WHERE id=$1", [issuerId])
    await expect(issueEmployeeInvitation(pool, issuerId, { email: 'person@example.test', ttlSeconds: 3600 })).rejects.toMatchObject({ code: 'issuer_forbidden' })
    expect((await pool.query('SELECT count(*) FROM enrollment_invitations')).rows[0].count).toBe(before)
  } finally { await pool.query("UPDATE users SET role='hr_admin', is_active=true WHERE id=$1", [issuerId]) }
})

test('two simultaneous redemptions create exactly one account and consume once', async () => {
  const email = `${randomUUID()}@example.test`
  const invite = await invitation(email)
  const input = account(invite.token, email)
  const blocker = await pool.connect()
  await blocker.query('BEGIN')
  await blocker.query('SELECT id FROM enrollment_invitations WHERE id = $1 FOR UPDATE', [invite.id])
  const outcomes = Promise.allSettled([redeemInvitation(pool, input), redeemInvitation(pool, input)])
  try {
    // Prove both requests reached a real lock wait before releasing them;
    // a fast sequential schedule is not sufficient concurrency evidence.
    await expect.poll(async () => Number((await maintenance.query(
      `SELECT count(*) FROM pg_stat_activity WHERE application_name = $1
       AND wait_event_type = 'Lock' AND query LIKE '%FROM enrollment_invitations%'`, [schema],
    )).rows[0].count), { timeout: 5_000 }).toBe(2)
  } finally {
    await blocker.query('ROLLBACK')
    blocker.release()
  }
  const results = await outcomes
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  const failure = results.find((result) => result.status === 'rejected') as PromiseRejectedResult
  expect(failure.reason.code).toBe('invitation_unavailable')
  expect(Number((await pool.query('SELECT count(*) FROM users WHERE email = $1', [email])).rows[0].count)).toBe(1)
  const winner = results.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<{ userId: string }>
  expect((await pool.query('SELECT consumed_by FROM enrollment_invitations WHERE id = $1', [invite.id])).rows[0].consumed_by).toBe(winner.value.userId)
})

for (const scenario of ['expired', 'revoked', 'wrong-identity', 'forged'] as const) {
  test(`rejects ${scenario} invitation without partial account creation`, async () => {
    const email = `${randomUUID()}@example.test`
    const invite = await invitation(email, scenario === 'expired' ? '-1 hour' : '1 hour', scenario === 'revoked')
    const claimedEmail = scenario === 'wrong-identity' ? `${randomUUID()}@example.test` : email
    const token = scenario === 'forged' ? createInvitationToken().token : invite.token
    await expect(redeemInvitation(pool, account(token, claimedEmail))).rejects.toMatchObject({ code: 'invitation_unavailable' })
    expect(Number((await pool.query('SELECT count(*) FROM users WHERE email = ANY($1::text[])', [[email, claimedEmail]])).rows[0].count)).toBe(0)
    await unused(invite.id)
  })
}

test('an existing email never changes company or role and does not consume the invitation', async () => {
  const email = `${randomUUID()}@example.test`
  const otherCompany = (await pool.query('INSERT INTO companies (name, email_domain) VALUES ($1, $2) RETURNING id', ['Existing company', `${randomUUID()}.test`])).rows[0].id
  const existing = (await pool.query('INSERT INTO users (company_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id', [otherCompany, 'Existing', email, await bcrypt.hash(randomBytes(24).toString('base64url'), 4), 'hr_admin'])).rows[0].id
  const invite = await invitation(email)
  await expect(redeemInvitation(pool, account(invite.token, email))).rejects.toMatchObject({ code: 'account_exists' })
  expect((await pool.query('SELECT company_id, role FROM users WHERE id = $1', [existing])).rows[0]).toEqual({ company_id: otherCompany, role: 'hr_admin' })
  await unused(invite.id)
})

test('failure between user insertion and invitation consumption rolls back both writes', async () => {
  const email = `${randomUUID()}@example.test`
  const invite = await invitation(email)
  await pool.query(`CREATE FUNCTION fail_ha05_consumption() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected consumption failure'; END $$`)
  await pool.query('CREATE TRIGGER fail_ha05_consumption BEFORE UPDATE ON enrollment_invitations FOR EACH ROW EXECUTE FUNCTION fail_ha05_consumption()')
  try {
    await expect(redeemInvitation(pool, account(invite.token, email))).rejects.toMatchObject({ code: 'enrollment_unavailable' })
    expect(Number((await pool.query('SELECT count(*) FROM users WHERE email = $1', [email])).rows[0].count)).toBe(0)
    await unused(invite.id)
  } finally {
    await pool.query('DROP TRIGGER fail_ha05_consumption ON enrollment_invitations')
    await pool.query('DROP FUNCTION fail_ha05_consumption()')
  }
})

test('expiry during insertion rolls back the account instead of consuming a stale invitation', async () => {
  const email = `${randomUUID()}@example.test`
  const invite = await invitation(email)
  // Deterministic fault injection advances this invitation's expiry inside the
  // INSERT trigger; the final consumption must re-read it rather than trust
  // the earlier SELECT snapshot. Transaction rollback restores the fixture.
  await pool.query(`CREATE FUNCTION expire_ha05_invitation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN UPDATE enrollment_invitations SET expires_at = clock_timestamp() - interval '1 second' WHERE intended_email = NEW.email; RETURN NEW; END $$`)
  await pool.query('CREATE TRIGGER expire_ha05_invitation BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION expire_ha05_invitation()')
  try {
    await expect(redeemInvitation(pool, account(invite.token, email))).rejects.toMatchObject({ code: 'invitation_unavailable' })
    expect(Number((await pool.query('SELECT count(*) FROM users WHERE email = $1', [email])).rows[0].count)).toBe(0)
    await unused(invite.id)
  } finally {
    await pool.query('DROP TRIGGER expire_ha05_invitation ON users')
    await pool.query('DROP FUNCTION expire_ha05_invitation()')
  }
})

function bootstrapInput() {
  const id = randomUUID()
  return { companyName: 'Controlled bootstrap', companyDomain: `${id}.test`, name: 'First HR',
    email: `${id}@unrelated.test`, password: randomBytes(24).toString('base64url') }
}

test('administrator bootstrap creates an explicit company and one active first HR atomically', async () => {
  const input = bootstrapInput()
  const result = await bootstrapCompany(pool, input)
  expect(result).toMatchObject({ kind: 'company_bootstrapped', next: 'sign_in' })
  const company = (await pool.query('SELECT name,email_domain FROM companies WHERE id=$1', [result.companyId])).rows[0]
  expect(company).toEqual({ name: input.companyName, email_domain: input.companyDomain })
  const users = (await pool.query('SELECT id,role,is_active,email,password_hash FROM users WHERE company_id=$1', [result.companyId])).rows
  expect(users).toHaveLength(1)
  expect(users[0]).toMatchObject({ id: result.firstHrId, role: 'hr_admin', is_active: true, email: input.email })
  expect(await bcrypt.compare(input.password, users[0].password_hash)).toBe(true)
  expect(JSON.stringify(result)).not.toContain(input.password)
})

test('two genuinely overlapping bootstrap requests cannot create two companies or first HR accounts', async () => {
  const input = bootstrapInput()
  const blocker = await pool.connect()
  await blocker.query('BEGIN; LOCK TABLE companies IN SHARE MODE')
  const outcomes = Promise.allSettled([bootstrapCompany(pool, input), bootstrapCompany(pool, { ...input, email: `${randomUUID()}@unrelated.test` })])
  try {
    await expect.poll(async () => Number((await maintenance.query(
      `SELECT count(*) FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND wait_event='relation' AND query LIKE '%companies%'`, [schema],
    )).rows[0].count), { timeout: 5_000 }).toBe(2)
  } finally { await blocker.query('ROLLBACK'); blocker.release() }
  const results = await outcomes
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.code).toBe('bootstrap_conflict')
  const companies = (await pool.query('SELECT id FROM companies WHERE email_domain=$1', [input.companyDomain])).rows
  expect(companies).toHaveLength(1)
  expect((await pool.query('SELECT count(*)::int AS count FROM users WHERE company_id=$1', [companies[0].id])).rows[0].count).toBe(1)
})

test('bootstrap never adopts an existing account and rolls back the new company on duplicate email', async () => {
  const input = { ...bootstrapInput(), email: `${issuerId}@example.test` }
  await expect(bootstrapCompany(pool, input)).rejects.toMatchObject({ code: 'bootstrap_conflict' })
  expect((await pool.query('SELECT id FROM companies WHERE email_domain=$1', [input.companyDomain])).rowCount).toBe(0)
  expect((await pool.query('SELECT company_id,role FROM users WHERE id=$1', [issuerId])).rows[0]).toEqual({ company_id: companyId, role: 'hr_admin' })
})

test('a failure after company insertion rolls the entire administrator bootstrap back without raw diagnostics', async () => {
  const input = bootstrapInput()
  await pool.query(`CREATE FUNCTION fail_ha05_bootstrap() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private bootstrap failure'; END $$;
    CREATE TRIGGER fail_ha05_bootstrap BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION fail_ha05_bootstrap()`)
  try {
    await expect(bootstrapCompany(pool, input)).rejects.toMatchObject({ code: 'bootstrap_unavailable', message: 'Company bootstrap could not be completed.' })
    expect((await pool.query('SELECT id FROM companies WHERE email_domain=$1', [input.companyDomain])).rowCount).toBe(0)
    expect((await pool.query('SELECT id FROM users WHERE email=$1', [input.email])).rowCount).toBe(0)
  } finally { await pool.query('DROP TRIGGER fail_ha05_bootstrap ON users; DROP FUNCTION fail_ha05_bootstrap()') }
})

test('a real restricted LOGIN cannot use administrator bootstrap', async () => {
  const role = `ha05_bootstrap_${randomUUID().replaceAll('-', '')}`
  const password = randomBytes(24).toString('base64url')
  const input = bootstrapInput()
  let restricted: Pool | undefined
  await maintenance.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`)
  try {
    const url = new URL(databaseURL!); url.username = role; url.password = password
    restricted = new Pool({ connectionString: url.toString() })
    await expect(bootstrapCompany(restricted, input)).rejects.toMatchObject({ code: 'administrator_required' })
    expect((await pool.query('SELECT id FROM companies WHERE email_domain=$1', [input.companyDomain])).rowCount).toBe(0)
  } finally { await restricted?.end(); await maintenance.query(`DROP ROLE ${role}`) }
})


test('current HR revocation is idempotent and prevents redemption without affecting other invitations', async () => {
  const email = `${randomUUID()}@example.test`
  const invite = await invitation(email)
  const other = await invitation(`${randomUUID()}@example.test`)
  const revoked = await revokeEmployeeInvitation(pool, issuerId, invite.id)
  expect(await revokeEmployeeInvitation(pool, issuerId, invite.id)).toEqual(revoked)
  await expect(redeemInvitation(pool, account(invite.token, email))).rejects.toMatchObject({ code: 'invitation_unavailable' })
  expect((await pool.query('SELECT id FROM users WHERE email=$1',[email])).rowCount).toBe(0)
  await unused(other.id)
})

test('revocation refuses stale HR rights, foreign invitations and consumed capabilities', async () => {
  const email = `${randomUUID()}@example.test`, invite = await invitation(email)
  const otherCompany = (await pool.query("INSERT INTO companies (name,email_domain) VALUES ('Foreign invitation',$1) RETURNING id", [`${randomUUID()}.test`])).rows[0].id
  try {
    await pool.query('UPDATE users SET is_active=false WHERE id=$1',[issuerId])
    await expect(revokeEmployeeInvitation(pool,issuerId,invite.id)).rejects.toMatchObject({ code: 'issuer_forbidden' })
    await pool.query("UPDATE users SET is_active=true,role='employee' WHERE id=$1",[issuerId])
    await expect(revokeEmployeeInvitation(pool,issuerId,invite.id)).rejects.toMatchObject({ code: 'issuer_forbidden' })
    await pool.query("UPDATE users SET role='hr_admin' WHERE id=$1",[issuerId])
    await pool.query('UPDATE enrollment_invitations SET company_id=$1 WHERE id=$2',[otherCompany,invite.id])
    await expect(revokeEmployeeInvitation(pool,issuerId,invite.id)).rejects.toMatchObject({ code: 'invitation_unavailable' })
    await pool.query('UPDATE enrollment_invitations SET company_id=$1 WHERE id=$2',[companyId,invite.id])
    await unused(invite.id)
    const result = await redeemInvitation(pool,account(invite.token,email))
    await expect(revokeEmployeeInvitation(pool,issuerId,invite.id)).rejects.toMatchObject({ code: 'invitation_unavailable' })
    expect((await pool.query('SELECT id FROM users WHERE id=$1',[result.userId])).rowCount).toBe(1)
  } finally {
    await pool.query("UPDATE users SET is_active=true,role='hr_admin' WHERE id=$1",[issuerId])
    await pool.query('UPDATE enrollment_invitations SET company_id=$1 WHERE id=$2',[companyId,invite.id])
  }
})

test('genuinely concurrent revocation and redemption produce one consistent terminal outcome', async () => {
  const email = `${randomUUID()}@example.test`, invite = await invitation(email)
  const gate = await pool.connect()
  await gate.query('BEGIN')
  await gate.query('SELECT id FROM enrollment_invitations WHERE id=$1 FOR UPDATE',[invite.id])
  const outcomes = Promise.allSettled([revokeEmployeeInvitation(pool,issuerId,invite.id),redeemInvitation(pool,account(invite.token,email))])
  try {
    await expect.poll(async () => Number((await maintenance.query(
      "SELECT count(*) FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE '%enrollment_invitations%'",[schema],
    )).rows[0].count), { timeout: 5_000 }).toBe(2)
  } finally { await gate.query('ROLLBACK'); gate.release() }
  const results = await outcomes
  expect(results.filter(result => result.status==='fulfilled')).toHaveLength(1)
  const stored = (await pool.query('SELECT revoked_at,consumed_at FROM enrollment_invitations WHERE id=$1',[invite.id])).rows[0]
  expect(Number(stored.revoked_at!==null)+Number(stored.consumed_at!==null)).toBe(1)
  expect((await pool.query('SELECT count(*)::int AS count FROM users WHERE email=$1',[email])).rows[0].count).toBe(stored.consumed_at ? 1 : 0)
})

test('public enrollment requires the private email proof and derives identity from the invitation', async () => {
  const email = `${randomUUID()}@unrelated-domain.test`
  const issued = await issueEmployeeInvitation(pool,issuerId,{email,ttlSeconds:3600})
  const input = {token:issued.token,emailProof:issued.proofToken,name:'Verified recipient',password:randomBytes(24).toString('base64url')}
  await expect(redeemInvitation(pool,{...input,emailProof:createInvitationToken().token,verifiedEmail:email})).rejects.toMatchObject({code:'invitation_unavailable'})
  await unused(issued.invitationId)
  const created = await redeemInvitation(pool,{...input,verifiedEmail:'forged@foreign.test'})
  expect(created.email).toBe(email)
  const row = (await pool.query('SELECT email,company_id,role FROM users WHERE id=$1',[created.userId])).rows[0]
  expect(row).toMatchObject({email,company_id:companyId,role:'employee'})
  await expect(redeemInvitation(pool,input)).rejects.toMatchObject({code:'invitation_unavailable'})
})


test('the ordered invitation migration upgrades existing data and supports a safe down/up', async () => {
  const isolated = `ha05_upgrade_${randomUUID().replaceAll('-', '')}`
  const directory = await mkdtemp(join(os.tmpdir(),'ha05-upgrade-'))
  const migration = '1792764000000_hamza_enrollment-invitations.sql'
  const quiet = () => {}
  const options = { databaseUrl: databaseURL!, dir: directory, schema: isolated, migrationsSchema: isolated, migrationsTable: 'pgmigrations', createSchema: true, checkOrder: true, singleTransaction: true, logger: { debug:quiet,info:quiet,warn:quiet,error:quiet } }
  const scoped = new Pool({ connectionString:databaseURL,options:`-c search_path=${isolated},public` })
  let created = false
  try {
    for (const name of await readdir('migrations')) if (name.endsWith('.sql') && Number(name.split('_')[0]) < Number(migration.split('_')[0])) await copyFile(join('migrations',name),join(directory,name))
    await runner({...options,direction:'up'}); created = true
    const company = randomUUID(), user = randomUUID(), email = `${user}@example.test`
    await scoped.query("INSERT INTO companies(id,name,email_domain) VALUES($1,'Existing',$2)",[company,`${company}.test`])
    await scoped.query("INSERT INTO users(id,company_id,name,email,password_hash,role) VALUES($1,$2,'Existing',$3,'unchanged','employee')",[user,company,email])
    const snapshot = (await scoped.query('SELECT * FROM users')).rows
    await copyFile(join('migrations',migration),join(directory,migration))
    expect(await runner({...options,direction:'up'})).toHaveLength(1)
    expect((await scoped.query('SELECT * FROM users')).rows).toEqual(snapshot)
    expect((await scoped.query('SELECT count(*)::int AS count FROM enrollment_invitations')).rows[0].count).toBe(0)
    expect(await runner({...options,direction:'down',count:1})).toHaveLength(1)
    expect((await scoped.query('SELECT * FROM users')).rows).toEqual(snapshot)
    expect(await runner({...options,direction:'up'})).toHaveLength(1)
    expect((await scoped.query('SELECT * FROM users')).rows).toEqual(snapshot)
  } finally {
    await scoped.end()
    if (created) await maintenance.query(`DROP SCHEMA ${isolated} CASCADE`)
    await rm(directory,{recursive:true,force:true})
  }
})
