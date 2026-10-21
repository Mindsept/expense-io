import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { Pool, type PoolClient } from 'pg'
import '../../../../src/lib/db' // Apply the production pg civil-date parser before using the real adapter.
import { DecideExpense } from '../../../../src/domain/DecideExpense'
import { PostgresExpenseDecisionAdapter } from '../../../../src/adapters/PostgresExpenseDecisionAdapter'
import { deliverOneDecisionNotification, enqueueDecisionNotification, PostgresInAppNotificationAdapter, readDecisionInbox, requeueFailedDecisionNotification, markDecisionInboxRead } from '../../../../proposals/HA-09/decision-inbox'

// The shared CI explicitly supplies this marker and its disposable connection.
const url = process.env.DATABASE_URL
if (process.env.ARLA_TEST_ENV !== 'isolated' || !url) throw new Error('HA-09 needs the explicitly isolated CI database contract.')
const target = new URL(url)
if (!['postgres:', 'postgresql:'].includes(target.protocol) || !['127.0.0.1', 'localhost'].includes(target.hostname) || !target.pathname.endsWith('_test')) throw new Error('HA-09 requires a disposable loopback *_test database.')
const schema = `ha09_${randomUUID().replaceAll('-', '')}`
const admin = new Pool({ connectionString: url })
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public`, max: 5 })
const company = randomUUID(), foreignCompany = randomUUID()
const ids = { manager: randomUUID(), owner: randomUUID(), hr: randomUUID(), foreignHr: randomUUID() }
const actor = { id: ids.manager, companyId: company, role: 'manager' as const }
const owner = { id: ids.owner, companyId: company, role: 'employee' as const }
const hr = { id: ids.hr, companyId: company, role: 'hr_admin' as const }
const foreignHr = { id: ids.foreignHr, companyId: foreignCompany, role: 'hr_admin' as const }
const policy = { maxAttempts: 2, retryDelaySeconds: 0 }
let created = false

test.beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`); created = true
  for (const name of ['1700000000001_init-schema.sql', '1792583999000_hamza_current-account.sql', '1792584000000_hamza_decision-history.sql']) {
    await pool.query(readFileSync(`migrations/${name}`, 'utf8').split('-- Down Migration')[0].replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''))
  }
  await pool.query(readFileSync('proposals/HA-09/decision-inbox.sql', 'utf8'))
  for (const id of [company, foreignCompany]) await pool.query('INSERT INTO companies (id,name,email_domain) VALUES ($1,$2,$3)', [id, 'HA09', `${id}.test`])
  for (const [name,id] of Object.entries(ids)) {
    await pool.query('INSERT INTO users (id,company_id,name,email,password_hash,role) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, name === 'foreignHr' ? foreignCompany : company, name, `${id}@example.test`, 'unused-not-a-login', name === 'owner' ? 'employee' : name === 'manager' ? 'manager' : 'hr_admin'])
  }
  await pool.query('UPDATE users SET manager_id=$1 WHERE id=$2', [ids.manager,ids.owner])
})
test.beforeEach(async () => {
  await pool.query('DELETE FROM expense_notes') // Own random schema only; dependent fixture rows cascade.
  await pool.query('UPDATE users SET company_id=$1, is_active=true WHERE id=$2', [company,ids.owner])
})
test.afterAll(async () => { await pool.end(); if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end() })

async function pendingNote() {
  const id = randomUUID()
  await pool.query("INSERT INTO expense_notes (id,user_id,amount,expense_date,description,receipt_key) VALUES ($1,$2,12.50,'2026-10-22','HA09 synthetic','ha09/fixture')", [id,ids.owner])
  return id
}
async function decideAndQueue(commit = true) {
  const id = await pendingNote(), client = await pool.connect()
  try {
    await client.query('BEGIN')
    const decided = await new DecideExpense(new PostgresExpenseDecisionAdapter(client)).execute({ expenseId: id, decision: 'approved', actor })
    await enqueueDecisionNotification(client, decided.event)
    await client.query(commit ? 'COMMIT' : 'ROLLBACK')
    return { id, event: decided.event }
  } finally { client.release() }
}
async function count(table: 'expense_decision_history' | 'decision_notification_outbox' | 'decision_inbox') {
  return Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count)
}

test('real decision, history and intent roll back together before any delivery', async () => {
  const { id } = await decideAndQueue(false)
  expect((await pool.query('SELECT status FROM expense_notes WHERE id=$1',[id])).rows[0].status).toBe('pending')
  expect(await count('expense_decision_history')).toBe(0)
  expect(await count('decision_notification_outbox')).toBe(0)
  expect(await count('decision_inbox')).toBe(0)
})

test('a stopped worker preserves the committed decision; repeated intent/delivery creates one inbox row', async () => {
  const { id, event } = await decideAndQueue()
  expect((await pool.query('SELECT status FROM expense_notes WHERE id=$1',[id])).rows[0].status).toBe('approved')
  expect(await count('decision_notification_outbox')).toBe(1)
  expect(await count('decision_inbox')).toBe(0)
  const client = await pool.connect()
  try { await enqueueDecisionNotification(client,event) } finally { client.release() }
  expect((await deliverOneDecisionNotification(pool,policy)).outcome).toBe('delivered')
  expect((await deliverOneDecisionNotification(pool,policy)).outcome).toBe('idle')
  expect(await count('decision_inbox')).toBe(1)
  const viewer = await pool.connect()
  try {
    expect(await readDecisionInbox(viewer,owner)).toEqual([{ eventId: event.id, expenseId: id, decision: 'approved', createdAt: expect.any(String), readAt: null }])
    expect(await requeueFailedDecisionNotification(viewer,event.id,hr)).toBe(false)
  } finally { viewer.release() }
})

test('two real workers overlap after reservation; the second skips the locked event', async () => {
  await decideAndQueue()
  let mark!: () => void, resume!: () => void
  const reserved = new Promise<void>(resolve => { mark = resolve })
  const release = new Promise<void>(resolve => { resume = resolve })
  const heldPool = { connect: async () => {
    const client = await pool.connect()
    return { query: async (sql: string, values?: unknown[]) => {
      const result = await client.query(sql,values)
      if (sql.includes('FOR UPDATE SKIP LOCKED') && result.rows[0]) { mark(); await release }
      return result
    }, release: (destroy?: boolean) => client.release(destroy) } as unknown as PoolClient
  } } as Pick<Pool,'connect'>
  const first = deliverOneDecisionNotification(heldPool,policy)
  try {
    await Promise.race([reserved, first.then(() => { throw new Error('First worker finished before reservation barrier.') })])
    expect((await deliverOneDecisionNotification(pool,policy)).outcome).toBe('idle')
    resume()
    expect((await first).outcome).toBe('delivered')
    expect(await count('decision_inbox')).toBe(1)
  } finally { resume(); await first.catch(() => {}) }
})

test('failed delivery is bounded and visible; authorized replay never replays an acknowledged event', async () => {
  const { id,event } = await decideAndQueue()
  const constraint = `ha09_fail_${randomUUID().replaceAll('-','')}`
  await pool.query(`ALTER TABLE decision_inbox ADD CONSTRAINT ${constraint} CHECK (event_id<>'${event.id}') NOT VALID`)
  try {
    expect((await deliverOneDecisionNotification(pool,policy)).outcome).toBe('retry')
    expect((await deliverOneDecisionNotification(pool,policy)).outcome).toBe('failed')
    expect((await pool.query('SELECT state,attempts,last_failure_code FROM decision_notification_outbox')).rows).toEqual([{ state: 'failed', attempts: 2, last_failure_code: 'delivery_failed' }])
    expect((await pool.query('SELECT status FROM expense_notes WHERE id=$1',[id])).rows[0].status).toBe('approved')
    expect(await count('decision_inbox')).toBe(0)
  } finally { await pool.query(`ALTER TABLE decision_inbox DROP CONSTRAINT ${constraint}`) }
  const client = await pool.connect()
  try {
    expect(await requeueFailedDecisionNotification(client,event.id,foreignHr)).toBe(false)
    expect(await requeueFailedDecisionNotification(client,event.id,hr)).toBe(true)
    expect((await deliverOneDecisionNotification(pool,policy)).outcome).toBe('delivered')
    expect(await requeueFailedDecisionNotification(client,event.id,hr)).toBe(false)
    expect(await count('decision_inbox')).toBe(1)
  } finally { client.release() }
})

test('connection death after inbox insertion rolls back and a restarted worker recovers', async () => {
  const { event,id } = await decideAndQueue()
  const crashed = await pool.connect()
  const pid = (await crashed.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
  await crashed.query('BEGIN')
  await crashed.query('SELECT event_id FROM decision_notification_outbox WHERE event_id=$1 FOR UPDATE',[event.id])
  await new PostgresInAppNotificationAdapter(crashed).notifyDecision(ids.owner,id,'approved',{ eventId: event.id })
  crashed.release(true) // Actual PostgreSQL session loss; no commit/acknowledgement.
  await expect.poll(async () => Number((await pool.query('SELECT count(*) FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0].count)).toBe(0)
  expect(await count('decision_inbox')).toBe(0)
  expect((await deliverOneDecisionNotification(pool,policy)).outcome).toBe('delivered')
  expect(await count('decision_inbox')).toBe(1)
})

test('inbox reads respect current recipient/company/activation after ownership changes', async () => {
  await decideAndQueue(); await deliverOneDecisionNotification(pool,policy)
  const client = await pool.connect()
  try {
    expect(await readDecisionInbox(client,foreignHr)).toEqual([])
    await pool.query('UPDATE users SET is_active=false WHERE id=$1',[ids.owner])
    expect(await readDecisionInbox(client,owner)).toEqual([])
    await pool.query('UPDATE users SET is_active=true,company_id=$1 WHERE id=$2',[foreignCompany,ids.owner])
    expect(await readDecisionInbox(client,owner)).toEqual([])
    expect(await readDecisionInbox(client,{ ...owner, companyId: foreignCompany })).toEqual([])
  } finally { client.release() }
})


test('read state is durable/idempotent, rolls back atomically and does not rewind delivery on replay', async () => {
  const { event, id } = await decideAndQueue()
  await deliverOneDecisionNotification(pool,policy)
  const client = await pool.connect()
  try {
    expect((await readDecisionInbox(client,owner))[0].readAt).toBeNull()
    await client.query('BEGIN')
    expect(await markDecisionInboxRead(client,owner,event.id)).toMatchObject({ eventId: event.id,readAt: expect.any(String) })
    await client.query('ROLLBACK')
    expect((await readDecisionInbox(client,owner))[0].readAt).toBeNull()
    const first = await markDecisionInboxRead(client,owner,event.id)
    expect(await markDecisionInboxRead(client,owner,event.id)).toEqual(first)
    await new PostgresInAppNotificationAdapter(client).notifyDecision(owner.id,id,'approved',{ eventId:event.id })
    expect((await readDecisionInbox(client,owner))[0].readAt).toBe(first!.readAt)
    expect((await client.query('SELECT state,attempts FROM decision_notification_outbox WHERE event_id=$1',[event.id])).rows[0]).toMatchObject({ state:'delivered',attempts:1 })
    expect(await count('decision_inbox')).toBe(1)
  } finally { await client.query('ROLLBACK');client.release() }
})

test('read-state commands recheck current owner, company and activation', async () => {
  const { event,id } = await decideAndQueue();await deliverOneDecisionNotification(pool,policy)
  const client = await pool.connect()
  try {
    expect(await markDecisionInboxRead(client,hr,event.id)).toBeNull()
    expect(await markDecisionInboxRead(client,foreignHr,event.id)).toBeNull()
    expect(await markDecisionInboxRead(client,owner,'invalid')).toBeNull()
    await pool.query('UPDATE users SET is_active=false WHERE id=$1',[owner.id])
    expect(await markDecisionInboxRead(client,owner,event.id)).toBeNull()
    await pool.query('UPDATE users SET is_active=true,company_id=$1 WHERE id=$2',[foreignCompany,owner.id])
    expect(await markDecisionInboxRead(client,owner,event.id)).toBeNull()
    await pool.query('UPDATE users SET company_id=$1 WHERE id=$2',[company,owner.id])
    await pool.query('UPDATE expense_notes SET user_id=$1 WHERE id=$2',[hr.id,id])
    expect(await markDecisionInboxRead(client,owner,event.id)).toBeNull()
    expect((await pool.query('SELECT read_at FROM decision_inbox WHERE event_id=$1',[event.id])).rows[0].read_at).toBeNull()
  } finally { client.release() }
})

test('a real limited inbox role updates only its read_at column and refuses cross-recipient rewrites', async () => {
  const { event } = await decideAndQueue();await deliverOneDecisionNotification(pool,policy)
  const role = `ha09_read_${randomUUID().replaceAll('-','')}`
  const password = randomUUID()+randomUUID()
  let limited: Pool | undefined
  let client: PoolClient | undefined
  await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`)
  try {
    await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}; GRANT SELECT ON ${schema}.users,${schema}.expense_notes,${schema}.decision_inbox TO ${role}; GRANT UPDATE(read_at) ON ${schema}.decision_inbox TO ${role}`)
    const target = new URL(url!);target.username=role;target.password=password
    limited = new Pool({connectionString:target.toString(),options:`-c search_path=${schema},public`,max:1})
    client = await limited.connect()
    expect(await markDecisionInboxRead(client,owner,event.id)).toBeNull()
    await client.query('BEGIN');await client.query("SELECT set_config('app.current_user_id',$1,true)",[owner.id])
    expect(await markDecisionInboxRead(client,owner,event.id)).toMatchObject({eventId:event.id,readAt:expect.any(String)})
    await client.query('SAVEPOINT protected_metadata')
    await expect(client.query("UPDATE decision_inbox SET decision='rejected' WHERE event_id=$1",[event.id])).rejects.toMatchObject({code:'42501'})
    await client.query('ROLLBACK TO SAVEPOINT protected_metadata')
    await client.query("SELECT set_config('app.current_user_id',$1,true)",[hr.id])
    expect(await markDecisionInboxRead(client,hr,event.id)).toBeNull()
    await client.query('ROLLBACK')
  } finally {
    if(client){await client.query('ROLLBACK');client.release()}
    await limited?.end();await admin.query(`DROP OWNED BY ${role};DROP ROLE ${role}`)
  }
})
