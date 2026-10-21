import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, copyFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runner } from 'node-pg-migrate'
import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'
import { assertResponse } from '../../../contracts/leandro/LE-10/openapi'

const baseURL = process.env.HA06_TEST_BASE_URL
const databaseURL = process.env.HA06_TEST_DATABASE_URL
const password = process.env.HA06_TEST_PASSWORD
if (!baseURL || !databaseURL || !password) throw new Error('Set HA06_TEST_BASE_URL, HA06_TEST_DATABASE_URL and HA06_TEST_PASSWORD for an isolated local test environment.')
const database = new URL(databaseURL)
if (!['localhost', '127.0.0.1'].includes(database.hostname) || !database.pathname.endsWith('_test')) throw new Error('HA-06 fixtures require a local _test database.')
if (!['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname)) throw new Error('HA-06 API tests require a local application.')

const pool = new Pool({ connectionString: databaseURL })
const company = randomUUID()
const foreignCompany = randomUUID()
const ids = Object.fromEntries(['hr1', 'hr2', 'A', 'B', 'C', 'D', 'employee', 'foreign'].map((name) => [name, randomUUID()]))
const contexts: APIRequestContext[] = []
const notes: string[] = []

test.beforeAll(async ({ playwright }) => {
  for (const id of [company, foreignCompany]) await pool.query('INSERT INTO companies (id,name,email_domain) VALUES ($1,$2,$3)', [id, 'HA06 fixture', `${id}.test`])
  const hash = await bcrypt.hash(password!, 4)
  for (const [name, id] of Object.entries(ids)) {
    await pool.query('INSERT INTO users (id,company_id,name,email,password_hash,role) VALUES ($1,$2,$3,$4,$5,$6)', [id, name === 'foreign' ? foreignCompany : company, name, `${id}@example.test`, hash, name.startsWith('hr') ? 'hr_admin' : name === 'employee' ? 'employee' : 'manager'])
  }
  for (const name of ['hr1', 'hr2', 'employee']) {
    const context = await playwright.request.newContext({ baseURL })
    contexts.push(context)
    const csrf = await (await context.get('/api/auth/csrf')).json()
    expect((await context.post('/api/auth/callback/credentials', { form: { csrfToken: csrf.csrfToken, email: `${ids[name]}@example.test`, password: password!, callbackUrl: `${baseURL}/hr` }, maxRedirects: 0 })).status()).toBe(302)
    expect((await (await context.get('/api/auth/session')).json()).user.id).toBe(ids[name])
  }
})
test.beforeEach(async () => { await pool.query('UPDATE users SET manager_id=NULL WHERE id=ANY($1::uuid[])', [Object.values(ids)]) })
test.afterAll(async () => {
  await Promise.all(contexts.map((context) => context.dispose()))
  await pool.query('DELETE FROM expense_notes WHERE id=ANY($1::uuid[])', [notes])
  await pool.query('UPDATE users SET manager_id=NULL WHERE id=ANY($1::uuid[])', [Object.values(ids)])
  await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [Object.values(ids)])
  await pool.query('DELETE FROM companies WHERE id=ANY($1::uuid[])', [[company, foreignCompany]])
  await pool.end()
})

async function createNote(owner: string) {
  const id = randomUUID(); notes.push(id)
  await pool.query("INSERT INTO expense_notes (id,user_id,amount,expense_date,description,receipt_key) VALUES ($1,$2,10,'2026-10-22','HA06 workflow','ha06/key')", [id, ids[owner]])
  return id
}

test('PO-01: role changes take effect for retained sessions and write one sensitive-change event', async () => {
  const before = Number((await pool.query('SELECT count(*) FROM management_changes WHERE target_id=$1', [ids.employee])).rows[0].count)
  try {
    const response = await contexts[0].put(`/api/hr/users/${ids.employee}/access`, { data: { role: 'manager' } })
    expect(response.status()).toBe(200)
    expect(await response.json()).toMatchObject({ id: ids.employee, role: 'manager', isActive: true })
    expect((await contexts[2].get('/api/manager/expense-notes')).status()).toBe(200)
    const events = await pool.query('SELECT actor_id, from_role, to_role, changed_at FROM management_changes WHERE target_id=$1 ORDER BY changed_at DESC', [ids.employee])
    expect(events.rows).toHaveLength(before + 1)
    expect(events.rows[0]).toMatchObject({ actor_id: ids.hr1, from_role: 'employee', to_role: 'manager', changed_at: expect.any(Date) })
    expect((await contexts[0].put(`/api/hr/users/${ids.employee}/access`, { data: { role: 'manager' } })).status()).toBe(200)
    expect(Number((await pool.query('SELECT count(*) FROM management_changes WHERE target_id=$1', [ids.employee])).rows[0].count)).toBe(before + 1)
  } finally { await pool.query("UPDATE users SET role='employee' WHERE id=$1", [ids.employee]) }
  expect((await contexts[2].get('/api/manager/expense-notes')).status()).toBe(403)
})

test('PO-01: two concurrent HR self-demotions cannot remove the last active HR', async () => {
  const gate = await pool.connect()
  let pending: Promise<APIResponse>[] = []
  try {
    await gate.query('BEGIN')
    await gate.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`expense-io:management:${company}`])
    pending = ['hr1', 'hr2'].map((name, index) => contexts[index].put(`/api/hr/users/${ids[name]}/access`, { data: { role: 'employee' } }))
    await expect.poll(async () => Number((await pool.query("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT pg_advisory_xact_lock%'")).rows[0].count)).toBe(2)
    await gate.query('COMMIT')
    const responses = await Promise.all(pending)
    expect(responses.map(r => r.status()).sort()).toEqual([200, 409])
    expect((await responses.find(r => r.status() === 409)!.json()).type).toBe('urn:expense-io:problem:last_active_hr')
    expect(Number((await pool.query("SELECT count(*) FROM users WHERE company_id=$1 AND role='hr_admin' AND is_active", [company])).rows[0].count)).toBe(1)
  } finally {
    await gate.query('ROLLBACK'); await Promise.allSettled(pending); gate.release()
    await pool.query("UPDATE users SET role='hr_admin', is_active=true WHERE id=ANY($1::uuid[])", [[ids.hr1, ids.hr2]])
  }
})

test('PO-01: last active HR deactivation fails; foreign/forged access updates are denied', async () => {
  try {
    expect((await contexts[0].put(`/api/hr/users/${ids.hr2}/access`, { data: { isActive: false } })).status()).toBe(200)
    const last = await contexts[0].put(`/api/hr/users/${ids.hr1}/access`, { data: { isActive: false } })
    expect(last.status()).toBe(409)
    expect((await last.json()).type).toBe('urn:expense-io:problem:last_active_hr')
    expect((await contexts[0].put(`/api/hr/users/${ids.foreign}/access`, { data: { role: 'hr_admin' } })).status()).toBe(404)
    expect((await contexts[2].put(`/api/hr/users/${ids.employee}/access`, { data: { role: 'hr_admin' } })).status()).toBe(403)
    expect((await contexts[0].put(`/api/hr/users/${ids.employee}/access`, { data: { companyId: foreignCompany, role: 'hr_admin' } })).status()).toBe(400)
  } finally { await pool.query('UPDATE users SET is_active=true WHERE id=$1', [ids.hr2]) }
})

test('PO-01: an HR owner sees a real waiting explanation when no peer HR is active', async () => {
  const id = await createNote('hr1')
  try {
    await pool.query('UPDATE users SET is_active=false WHERE id=$1', [ids.hr2])
    const response = await contexts[0].get(`/api/expense-notes/${id}/validation-status`)
    expect(response.status()).toBe(200)
    expect(await response.json()).toEqual({ status: 'pending', validation: { kind: 'none', reasonCode: 'no_other_active_hr', message: expect.stringContaining('reste en attente') } })
    expect((await contexts[2].get(`/api/expense-notes/${id}/validation-status`)).status()).toBe(404)
    expect((await contexts[0].post(`/api/hr/expense-notes/${id}/approve`)).status()).toBe(404)
  } finally { await pool.query('UPDATE users SET is_active=true WHERE id=$1', [ids.hr2]) }
})

test('PO-01: owner routing reflects active manager/HR recourse without inventing the no-validator rule', async () => {
  const id = await createNote('employee')
  try {
    await edge('employee', 'A')
    expect((await (await contexts[2].get(`/api/expense-notes/${id}/validation-status`)).json()).validation.reasonCode).toBe('direct_manager')
    await pool.query('UPDATE users SET is_active=false WHERE id=$1', [ids.A])
    expect((await (await contexts[2].get(`/api/expense-notes/${id}/validation-status`)).json()).validation.reasonCode).toBe('hr_recourse')
    await pool.query('UPDATE users SET is_active=false WHERE id=ANY($1::uuid[])', [[ids.hr1, ids.hr2]])
    expect((await (await contexts[2].get(`/api/expense-notes/${id}/validation-status`)).json()).validation.reasonCode).toBe('routing_policy_pending')
  } finally { await pool.query('UPDATE users SET is_active=true WHERE id=ANY($1::uuid[])', [[ids.A, ids.hr1, ids.hr2]]) }
})

test('sensitive-change history failure rolls back the requested role change', async () => {
  const constraint = `ha06_fail_${randomUUID().replaceAll('-', '')}`
  const before = (await pool.query('SELECT role FROM users WHERE id=$1', [ids.employee])).rows[0].role
  await pool.query(`ALTER TABLE management_changes ADD CONSTRAINT ${constraint} CHECK (target_id <> '${ids.employee}') NOT VALID`)
  try {
    const response = await contexts[0].put(`/api/hr/users/${ids.employee}/access`, { data: { role: 'manager' } })
    expect(response.status()).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain(constraint)
    expect((await pool.query('SELECT role FROM users WHERE id=$1', [ids.employee])).rows[0].role).toBe(before)
  } finally { await pool.query(`ALTER TABLE management_changes DROP CONSTRAINT ${constraint}`) }
})

const assign = (target: string, manager: string | null, context = contexts[0]) => context.put(`/api/hr/users/${ids[target]}/manager`, { data: { managerId: manager === null ? null : ids[manager] } })
async function edge(target: string, manager: string | null) { await pool.query('UPDATE users SET manager_id=$1 WHERE id=$2', [manager === null ? null : ids[manager], ids[target]]) }
async function snapshot() { return (await pool.query('SELECT id,manager_id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id', [Object.values(ids)])).rows }
async function expectAcyclic() {
  const result = await pool.query(`WITH RECURSIVE paths AS (
    SELECT id, manager_id, ARRAY[id] AS path, false AS cycle FROM users WHERE company_id=$1
    UNION ALL
    SELECT u.id, u.manager_id, p.path || u.id, u.id=ANY(p.path)
    FROM paths p JOIN users u ON u.id=p.manager_id WHERE NOT p.cycle
  ) SELECT EXISTS (SELECT 1 FROM paths WHERE cycle) AS has_cycle`, [company])
  expect(result.rows[0].has_cycle).toBe(false)
}
async function cycleProblem(response: APIResponse) {
  expect(response.status()).toBe(409)
  const body = await response.json()
  assertResponse('/api/hr/users/{id}/manager', 'put', response.status(), response.headers(), body)
  expect(body.type).toBe('urn:expense-io:problem:manager_cycle')
  expect(body.error).toBe(body.detail)
  expect(body.detail).toBe('This assignment would create or join a management cycle.')
  expect(body.requestId).toBe(response.headers()['x-request-id'])
}

async function race(first: [string, string], second: [string, string]) {
  // Queue both real HTTP transactions before releasing either graph writer.
  const gate = await pool.connect()
  let pending: Promise<APIResponse>[] = []
  try {
    await gate.query('BEGIN')
    await gate.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`expense-io:management:${company}`])
    pending = [assign(...first, contexts[0]), assign(...second, contexts[1])]
    await expect.poll(async () => Number((await pool.query("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT pg_advisory_xact_lock%'")).rows[0].count)).toBe(2)
    await gate.query('COMMIT')
    const responses = await Promise.all(pending)
    expect(responses.map((response) => response.status()).sort()).toEqual([200, 409])
    await cycleProblem(responses.find((response) => response.status() === 409)!)
    await expectAcyclic()
    return responses
  } finally {
    await gate.query('ROLLBACK')
    await Promise.allSettled(pending)
    gate.release()
  }
}

test('ordinary same-company employee and manager assignments preserve the response contract', async () => {
  expect((await assign('A', 'B')).status()).toBe(200)
  const response = await assign('employee', 'A')
  expect(response.status()).toBe(200)
  expect(await response.json()).toEqual({ id: ids.employee, name: 'employee', email: `${ids.employee}@example.test`, role: 'employee', managerId: ids.A })
  await expectAcyclic()
})

test('direct self-management is a stable conflict and leaves the graph unchanged', async () => {
  const before = await snapshot()
  await cycleProblem(await assign('A', 'A'))
  expect(await snapshot()).toEqual(before)
})

test('A managed by B and B by C prevents C from joining A', async () => {
  await edge('A', 'B')
  await edge('B', 'C')
  const before = await snapshot()
  await cycleProblem(await assign('C', 'A'))
  expect(await snapshot()).toEqual(before)
  await expectAcyclic()
})

test('an existing cycle cannot gain a new dependent member', async () => {
  await edge('B', 'C')
  await edge('C', 'B')
  const before = await snapshot()
  await cycleProblem(await assign('A', 'B'))
  expect(await snapshot()).toEqual(before)
})

test('explicit null can repair a historical cycle without inventing a new validation circuit', async () => {
  await edge('A', 'B')
  await edge('B', 'A')
  const response = await assign('A', null)
  expect(response.status()).toBe(200)
  expect((await response.json()).managerId).toBeNull()
  await expectAcyclic()
})

test('a foreign manager or foreign ancestor is rejected without changing the graph', async () => {
  expect((await assign('A', 'foreign')).status()).toBe(409)
  await edge('B', 'foreign')
  const before = await snapshot()
  const response = await assign('A', 'B')
  expect(response.status()).toBe(409)
  expect((await response.json()).type).toBe('urn:expense-io:problem:invalid_manager')
  expect(await snapshot()).toEqual(before)
})

test('opposite assignments from two HR actors yield exactly one success and one conflict', async () => {
  await race(['A', 'B'], ['B', 'A'])
  const edges = (await snapshot()).filter((row) => [ids.A, ids.B].includes(row.id))
  expect(edges.filter((row) => row.manager_id !== null)).toHaveLength(1)
})

test('concurrent closure of a longer graph also yields exactly one success and one conflict', async () => {
  await edge('A', 'B')
  await edge('C', 'D')
  await race(['B', 'C'], ['D', 'A'])
  const edges = (await snapshot()).filter((row) => [ids.A, ids.B, ids.C, ids.D].includes(row.id))
  expect(edges.filter((row) => row.manager_id !== null)).toHaveLength(3)
})

test('a manager read cannot deadlock with a target-first assignment; the conflict can be retried', async () => {
  // The dangerous UUID order is subordinate first, current manager second.
  const [subordinate, manager] = ['A', 'B'].sort((a, b) => ids[a].localeCompare(ids[b]))
  await edge(subordinate, manager)
  const before = await snapshot()
  const reader = await pool.connect()
  try {
    await reader.query('BEGIN')
    await reader.query("SET LOCAL statement_timeout = '3s'")
    // Match withCurrentActor's first lock for a manager decision or receipt.
    await reader.query('SELECT id, company_id, role FROM users WHERE id=$1 FOR SHARE', [ids[manager]])
    const busy = await contexts[0].put(`/api/hr/users/${ids[subordinate]}/manager`, {
      data: { managerId: ids[manager] }, timeout: 5000,
    })
    expect(busy.status()).toBe(409)
    expect(await busy.json()).toMatchObject({
      type: 'urn:expense-io:problem:manager_assignment_busy',
      detail: 'This assignment is being used by another operation. Try again.',
      error: 'This assignment is being used by another operation. Try again.',
      requestId: busy.headers()['x-request-id'],
    })
    // The failed assignment must roll back its earlier subordinate lock, allowing
    // the reader's next author lock while it still holds the manager lock.
    const author = await reader.query('SELECT id FROM users WHERE id=$1 AND manager_id=$2 AND company_id=$3 FOR SHARE', [ids[subordinate], ids[manager], company])
    expect(author.rows).toEqual([{ id: ids[subordinate] }])
    expect(await snapshot()).toEqual(before)
    await reader.query('COMMIT')
    expect((await assign(subordinate, manager)).status()).toBe(200)
    await expectAcyclic()
  } finally {
    await reader.query('ROLLBACK')
    reader.release()
  }
})


async function schemaChecked(response: APIResponse, path: string, method: string, status: number) {
  expect(response.status()).toBe(status)
  const body = await response.json()
  assertResponse(path, method, status, response.headers(), body)
  return body
}

test('delivered OpenAPI validates lifecycle success, refusal, last-HR and busy HTTP responses', async ({ playwright }) => {
  const path = '/api/hr/users/{id}/access'
  const anonymous = await playwright.request.newContext({ baseURL })
  const target = `/api/hr/users/${ids.employee}/access`
  try {
    await schemaChecked(await anonymous.put(target), path, 'put', 401)
    await schemaChecked(await contexts[2].put(target, { data: { role: 'hr_admin' } }), path, 'put', 403)
    await schemaChecked(await contexts[0].put(target, { data: {} }), path, 'put', 400)
    await schemaChecked(await contexts[0].put('/api/hr/users/invalid/access', { data: { isActive: true } }), path, 'put', 400)
    await schemaChecked(await contexts[0].put(target, { data: { companyId: foreignCompany } }), path, 'put', 400)
    await schemaChecked(await contexts[0].put(`/api/hr/users/${ids.foreign}/access`, { data: { isActive: false } }), path, 'put', 404)
    const result = await schemaChecked(await contexts[0].put(target, { data: { isActive: true } }), path, 'put', 200)
    expect(result).toEqual({ id: ids.employee, role: 'employee', isActive: true, managerId: null })
    await pool.query('UPDATE users SET is_active=false WHERE id=$1', [ids.hr2])
    const last = await schemaChecked(await contexts[0].put(`/api/hr/users/${ids.hr1}/access`, { data: { isActive: false } }), path, 'put', 409)
    expect(last.type).toBe('urn:expense-io:problem:last_active_hr')
    await pool.query('UPDATE users SET is_active=true WHERE id=$1', [ids.hr2])
    const lock = await pool.connect()
    try {
      await lock.query('BEGIN')
      await lock.query('SELECT id FROM users WHERE id=$1 FOR SHARE', [ids.employee])
      const busy = await schemaChecked(await contexts[0].put(target, { data: { role: 'manager' } }), path, 'put', 409)
      expect(busy.type).toBe('urn:expense-io:problem:manager_assignment_busy')
    } finally { await lock.query('ROLLBACK'); lock.release() }
  } finally {
    await pool.query('UPDATE users SET is_active=true WHERE id=$1', [ids.hr2])
    await anonymous.dispose()
  }
})

test('delivered OpenAPI validates current owner routing and rejects mutations of actual DTOs', async ({ playwright }) => {
  const path = '/api/expense-notes/{id}/validation-status'
  const id = await createNote('employee')
  const target = `/api/expense-notes/${id}/validation-status`
  const anonymous = await playwright.request.newContext({ baseURL })
  try {
    await schemaChecked(await anonymous.get(target), path, 'get', 401)
    await schemaChecked(await contexts[0].get(target), path, 'get', 404)
    await schemaChecked(await contexts[2].get(`/api/expense-notes/${randomUUID()}/validation-status`), path, 'get', 404)
    await schemaChecked(await contexts[2].get('/api/expense-notes/invalid/validation-status'), path, 'get', 500)
    await edge('employee', 'A')
    const response = await contexts[2].get(target)
    const body = await schemaChecked(response, path, 'get', 200)
    expect(body.validation.reasonCode).toBe('direct_manager')
    expect(() => assertResponse(path, 'get', 200, response.headers(), { ...body, email: 'private@example.test' })).toThrow()
    expect(() => assertResponse(path, 'get', 200, response.headers(), { ...body, status: 'finished' })).toThrow()
  } finally { await anonymous.dispose() }
})


test('real migration runner upgrades the existing LE-03 database in order and rolls the audit migration back safely', async () => {
  const schema = `ha06_upgrade_${randomUUID().replaceAll('-', '')}`
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ha06-upgrade-'))
  const migration = '1792749601000_hamza_management-audit.sql'
  const quiet = () => {}
  const options = { databaseUrl: databaseURL!, dir: directory, schema, migrationsSchema: schema,
    migrationsTable: 'pgmigrations', createSchema: true, checkOrder: true, singleTransaction: true,
    logger: { debug: quiet, info: quiet, warn: quiet, error: quiet } }
  const scoped = new Pool({ connectionString: databaseURL, options: `-c search_path=${schema},public` })
  let created = false
  try {
    for (const name of await readdir('migrations')) if (name.endsWith('.sql') && name !== migration) {
      await copyFile(path.join('migrations', name), path.join(directory, name))
    }
    await runner({ ...options, direction: 'up' }); created = true
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
    await scoped.query("INSERT INTO companies (id,name,email_domain) VALUES ($1,'Existing demo',$2)", [ids[0], `${ids[0]}.test`])
    await scoped.query("INSERT INTO users (id,company_id,name,email,password_hash,role) VALUES ($1,$3,'Owner',$4,'unused','employee'),($2,$3,'HR',$5,'unused','hr_admin')", [ids[1], ids[2], ids[0], `${ids[1]}@example.test`, `${ids[2]}@example.test`])
    await scoped.query("INSERT INTO expense_notes (id,user_id,amount,expense_date,description,receipt_key,status) VALUES ($1,$2,12.50,'2026-10-22','Existing note','synthetic/migration','approved')", [ids[3], ids[1]])
    await scoped.query("INSERT INTO expense_decision_history (expense_note_id,actor_id,company_id,actor_display_name,from_status,to_status) VALUES ($1,$2,$3,'HR','pending','approved')", [ids[3], ids[2], ids[0]])
    const snapshot = async () => ({ notes: (await scoped.query('SELECT * FROM expense_notes')).rows, history: (await scoped.query('SELECT * FROM expense_decision_history')).rows })
    const before = await snapshot()
    await copyFile(path.join('migrations', migration), path.join(directory, migration))
    expect(await runner({ ...options, direction: 'up' })).toHaveLength(1)
    expect(await snapshot()).toEqual(before)
    expect((await scoped.query('SELECT count(*)::int AS count FROM management_changes')).rows[0].count).toBe(0)
    expect(await runner({ ...options, direction: 'down', count: 1 })).toHaveLength(1)
    expect((await scoped.query('SELECT to_regclass($1) AS table_name', [`${schema}.management_changes`])).rows[0].table_name).toBeNull()
    expect(await snapshot()).toEqual(before)
    expect(await runner({ ...options, direction: 'up' })).toHaveLength(1)
    expect(await snapshot()).toEqual(before)
  } finally {
    await scoped.end()
    if (created) await pool.query(`DROP SCHEMA ${schema} CASCADE`)
    await rm(directory, { recursive: true, force: true })
  }
})
