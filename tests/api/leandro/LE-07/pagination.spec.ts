import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { runtimeFixture } from '../../../contracts/hamza/HA-04/runtime-fixture'
import { readTestIdentity, readTestTarget } from '../../../support/test-target'
import { assertResponse } from '../../../contracts/leandro/LE-10/openapi'

readTestTarget()
const password = readTestIdentity('EMPLOYEE').password
let fixture: Awaited<ReturnType<typeof runtimeFixture>>
const contexts: APIRequestContext[] = []
let employeeClient: APIRequestContext, managerClient: APIRequestContext, hrClient: APIRequestContext
const ids = { employee: randomUUID(), manager: randomUUID(), otherEmployee: randomUUID(), otherManager: randomUUID(), peerHr: randomUUID(), foreign: randomUUID() }
const foreignCompany = randomUUID(), candidateIds = Array.from({ length: 25 }, () => randomUUID())
const inactive = randomUUID(), literalCandidate = randomUUID(), needle = randomUUID()
const ownNotes = Array.from({ length: 45 }, () => randomUUID())
const managerNotes = ownNotes
const hrNotes = Array.from({ length: 45 }, () => randomUUID())
const sum = Array.from({ length: 45 }, (_, index) => (index + 1) * 100 + 10).reduce((a,b) => a+b, 0) / 100
const paths = ['/api/expense-notes','/api/manager/expense-notes','/api/hr/expense-notes']

type Note = { id: string; amount: number; status: string; author?: { id: string; displayName: string } }
type Page = { items: Note[]; pagination: { page: number; pageSize: number; totalItems: number }; totals: { amount?: number; count: number; scope: string }; selectedManager?: { id: string; name: string; role: string; isActive: boolean; isEligible: boolean } | null }
async function response(client: APIRequestContext, path: string, status = 200) {
  const result = await client.get(path)
  expect(result.status()).toBe(status)
  const body = await result.json()
  assertResponse(path.split('?')[0], 'get', status, result.headers(), body)
  expect(JSON.stringify(body)).not.toMatch(/password_hash|company_id|manager_id|SELECT |postgres:\/\/|X-Amz-/)
  if (status === 200) {
    expect(result.headers()['cache-control']).toBe('no-store')
    expect(result.headers()['x-pagination-mode']).toBe('paged')
  }
  return body
}
async function login(context: APIRequestContext, id: string, credential = password) {
  contexts.push(context)
  const { csrfToken } = await (await context.get('/api/auth/csrf')).json()
  expect((await context.post('/api/auth/callback/credentials', { form: { csrfToken, email: id === fixture.hr ? fixture.hrEmail : `${id}@example.test`, password: credential }, maxRedirects: 0 })).status()).toBe(302)
  expect((await (await context.get('/api/auth/session')).json()).user.id).toBe(id)
  return context
}
async function notes(owner: string, notes: string[], amountMultiplier = 1) {
  for (const [index, id] of notes.entries()) await fixture.admin.query(`INSERT INTO expense_notes(id,user_id,amount,expense_date,description,receipt_key,status,created_at)
    VALUES($1,$2,$3,'2024-02-29','LE-07 synthetic',$4,'pending','2026-10-23T12:00:00Z')`, [id, owner, (((index + 1) * 100 + 10) * amountMultiplier / 100).toFixed(2), `le07/${id}.png`])
}

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(60_000)
  fixture = await runtimeFixture(3147)
  const hash = await bcrypt.hash(password, 4)
  await fixture.admin.query('INSERT INTO companies(id,name,email_domain) VALUES($1,$2,$3)', [foreignCompany, 'LE-07 foreign', `${foreignCompany}.test`])
  for (const [key,id] of Object.entries(ids)) {
    const role = key === 'peerHr' ? 'hr_admin' : key === 'foreign' ? 'manager' : key.toLowerCase().includes('manager') ? 'manager' : 'employee'
    await fixture.admin.query('INSERT INTO users(id,company_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5,$6)', [id, key === 'foreign' ? foreignCompany : fixture.company, key === 'otherManager' ? 'ZZZ selected manager' : key === 'foreign' ? 'Needle manager' : `LE07 ${key}`, `${id}@example.test`, hash, role])
  }
  for (const [index,id] of candidateIds.entries()) await fixture.admin.query("INSERT INTO users(id,company_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5,'manager')", [id, fixture.company, `AAA manager ${String(index).padStart(2,'0')}`, `${id}@example.test`, hash])
  for (const [id,name,active] of [[inactive,'Inactive manager',false],[literalCandidate,'Literal %_\\ manager',true],[needle,'Needle manager',true]] as const) await fixture.admin.query("INSERT INTO users(id,company_id,name,email,password_hash,role,is_active) VALUES($1,$2,$3,$4,$5,'manager',$6)", [id,fixture.company,name,`${id}@example.test`,hash,active])
  await fixture.admin.query("UPDATE users SET manager_id=CASE id WHEN $1 THEN $2::uuid ELSE $3::uuid END WHERE id=ANY($4::uuid[])", [ids.employee, ids.manager, ids.otherManager, [ids.employee,ids.otherEmployee]])
  // Corrupt cross-company edge deliberately created as fixture administrator;
  // neither explicit predicates nor RLS may treat it as a visible direct report.
  await fixture.admin.query('UPDATE users SET manager_id=$1 WHERE id=$2', [ids.manager, ids.foreign])
  await notes(ids.employee, ownNotes); await notes(ids.peerHr, hrNotes)
  await notes(ids.otherEmployee, Array.from({ length: 8 }, () => randomUUID()), 100)
  await notes(ids.foreign, Array.from({ length: 45 }, () => randomUUID()), 100)
  await notes(fixture.hr, [randomUUID()], 100)
  employeeClient = await login(await playwright.request.newContext({ baseURL: fixture.baseURL }), ids.employee)
  managerClient = await login(await playwright.request.newContext({ baseURL: fixture.baseURL }), ids.manager)
  hrClient = await login(await playwright.request.newContext({ baseURL: fixture.baseURL }), fixture.hr, fixture.password)
})
test.afterAll(async () => { await Promise.all(contexts.map(context => context.dispose())); await fixture?.close() })

for (const [index, label] of ['personal','manager','HR'].entries()) {
  test(`${label}: real restricted login serves 20/20/5 with full totals and no duplicate/tie gaps`, async () => {
    const client = [employeeClient,managerClient,hrClient][index]
    const expected = [...(index === 2 ? hrNotes : managerNotes)].sort()
    if (index === 0) expected.reverse()
    const seen: string[] = []
    for (const [page,size] of [[1,20],[2,20],[3,5]]) {
      const body: Page = await response(client, `${paths[index]}?page=${page}&pageSize=20`)
      expect(body.items).toHaveLength(size)
      expect(body.pagination).toEqual({ page, pageSize: 20, totalItems: 45 })
      expect(body.totals).toEqual({ amount: sum, count: 45, scope: 'filtered' })
      expect(body.items.reduce((amount,note) => amount+note.amount,0)).toBeLessThan(sum)
      if (index > 0) expect(body.items.every(note => note.author?.id === (index === 2 ? ids.peerHr : ids.employee))).toBe(true)
      seen.push(...body.items.map(note => note.id))
    }
    expect(seen).toEqual(expected)
    expect(new Set(seen).size).toBe(45)
    const empty: Page = await response(client, `${paths[index]}?page=4&pageSize=20`)
    expect(empty.items).toEqual([]); expect(empty.totals).toEqual({ amount: sum, count: 45, scope: 'filtered' })
    const defaultPage: Page = await response(client, paths[index])
    expect(defaultPage.items.map(note => note.id)).toEqual(expected.slice(0,20))
    expect(defaultPage.pagination).toEqual({ page: 1, pageSize: 20, totalItems: 45 })
    expect(defaultPage.totals).toEqual({ amount: sum, count: 45, scope: 'filtered' })
  })
}

test('all six sorts keep deterministic UUID ties and the bounded defaults are stable', async () => {
  for (const sort of ['created_at ASC','created_at DESC','amount ASC','amount DESC','expense_date ASC','expense_date DESC']) {
    const body: Page = await response(employeeClient, `/api/expense-notes?pageSize=100&sort=${encodeURIComponent(sort)}`)
    expect(body.items).toHaveLength(45); expect(body.pagination).toEqual({ page: 1, pageSize: 100, totalItems: 45 })
    if (sort.startsWith('amount')) {
      const amounts = body.items.map(note => note.amount)
      expect(amounts).toEqual([...amounts].sort((a,b) => sort.endsWith('ASC') ? a-b : b-a))
    } else expect(body.items.map(note => note.id)).toEqual([...ownNotes].sort((a,b) => sort.endsWith('ASC') ? a.localeCompare(b) : b.localeCompare(a)))
  }
  expect((await response(employeeClient, '/api/expense-notes?page=2')).pagination).toEqual({ page: 2, pageSize: 20, totalItems: 45 })
})

test('malformed parameters are Problem Details and authorization still takes precedence', async ({ playwright }) => {
  const anonymous = await playwright.request.newContext({ baseURL: fixture.baseURL }); contexts.push(anonymous)
  for (const [index, path] of [...paths,'/api/hr/users'].entries()) {
    const client = [employeeClient,managerClient,hrClient,hrClient][index]
    for (const query of ['page=0','page=1.5','pageSize=101','page=1&page=2','page=9007199254740992']) {
      const body = await response(client, `${path}?${query}`, 400)
      expect(body.type).toBe('urn:expense-io:problem:validation')
    }
    await response(anonymous, `${path}?page=not-a-page`, 401)
  }
  await response(employeeClient, '/api/manager/expense-notes?page=bad', 403)
  await response(employeeClient, '/api/hr/users?page=bad', 403)
  await response(hrClient, '/api/hr/users?page=1&role=hr_admin', 400)
  await response(hrClient, '/api/hr/users?page=1&selectedManagerId=invalid', 400)
  expect((await response(hrClient, '/api/hr/users?selectedManagerId='+ids.manager)).selectedManager.id).toBe(ids.manager)
})

test('the directory and global manager search are independently paged, scoped and literal', async () => {
  const defaultPage = await response(hrClient, '/api/hr/users')
  expect(defaultPage.items).toHaveLength(20)
  expect(defaultPage.pagination.totalItems).toBeGreaterThan(20)
  const first: Page = await response(hrClient, '/api/hr/users?page=1&pageSize=3')
  expect(first.items).toHaveLength(3)
  expect(first.pagination.totalItems).toBe(defaultPage.pagination.totalItems)
  expect(first.totals).toEqual({ count: defaultPage.pagination.totalItems, scope: 'filtered' })
  const search = await response(hrClient, '/api/hr/users?page=1&pageSize=3&role=manager&q=Needle')
  expect(search.items.map((user: {id:string}) => user.id)).toEqual([needle])
  expect(first.items.some(user => user.id === needle)).toBe(false)
  const literals = await response(hrClient, '/api/hr/users?page=1&role=manager&q='+encodeURIComponent('%_\\'))
  expect(literals.items.map((user: {id:string}) => user.id)).toEqual([literalCandidate])
  const injection = await response(hrClient, '/api/hr/users?page=1&role=manager&q='+encodeURIComponent("%' OR true --"))
  expect(injection.items).toEqual([]); expect(injection.totals).toEqual({ count: 0, scope: 'filtered' })
  const managers = await response(hrClient, '/api/hr/users?page=1&pageSize=100&role=manager')
  expect(managers.items).toHaveLength(29)
  expect(managers.items.some((user: {id:string}) => user.id === inactive)).toBe(false)
  expect(JSON.stringify(managers)).not.toContain(ids.foreign)
})

test('the selected manager is resolved outside the page and search without changing filtered totals', async () => {
  const path = '/api/hr/users?page=1&pageSize=2&role=manager&q=Needle&selectedManagerId='
  const body: Page = await response(hrClient, path+ids.otherManager)
  expect(body.items.map(user => user.id)).toEqual([needle])
  expect(body.totals).toEqual({ count: 1, scope: 'filtered' })
  expect(body.selectedManager).toEqual({ id: ids.otherManager, name: 'ZZZ selected manager', role: 'manager', isActive: true, isEligible: true })
  const inactiveSelection: Page = await response(hrClient, path+inactive)
  expect(inactiveSelection.selectedManager).toMatchObject({ id: inactive, isActive: false, isEligible: false })
  const reclassified: Page = await response(hrClient, path+ids.peerHr)
  expect(reclassified.selectedManager).toMatchObject({ id: ids.peerHr, role: 'hr_admin', isEligible: false })
  const foreign: Page = await response(hrClient, path+ids.foreign)
  const absent: Page = await response(hrClient, path+randomUUID())
  expect(foreign).toEqual(absent)
  expect(foreign.selectedManager).toBeNull()
})

test('current status and manager eligibility change pages and aggregates together', async () => {
  const note = ownNotes[0]
  try {
    await fixture.admin.query("UPDATE expense_notes SET status='approved' WHERE id=$1", [note])
    const body: Page = await response(managerClient, '/api/manager/expense-notes?page=1&pageSize=100')
    expect(body.pagination.totalItems).toBe(44)
    expect(body.items.map(item => item.id)).not.toContain(note)
    expect(body.totals.amount).toBe(sum-1.1)
    const own: Page = await response(employeeClient, '/api/expense-notes?page=1&pageSize=100')
    expect(own.pagination.totalItems).toBe(45)
    await fixture.admin.query('UPDATE users SET is_active=false WHERE id=$1', [ids.manager])
    const recourse: Page = await response(hrClient, '/api/hr/expense-notes?page=1&pageSize=100')
    expect(recourse.pagination.totalItems).toBe(89)
    expect(recourse.totals.amount).toBe(sum*2-1.1)
  } finally {
    await fixture.admin.query("UPDATE expense_notes SET status='pending' WHERE id=$1", [note])
    await fixture.admin.query('UPDATE users SET is_active=true WHERE id=$1', [ids.manager])
  }
})

test('old sessions cannot retain role, active status or company scope for pages or manager identities', async () => {
  try {
    await fixture.admin.query('UPDATE users SET is_active=false WHERE id=$1', [ids.employee])
    await response(employeeClient, '/api/expense-notes?page=1', 401)
    await fixture.admin.query("UPDATE users SET role='employee' WHERE id=$1", [ids.manager])
    await response(managerClient, '/api/manager/expense-notes?page=1', 403)
    await fixture.admin.query('UPDATE users SET company_id=$2 WHERE id=$1', [fixture.hr, foreignCompany])
    const body = await response(hrClient, '/api/hr/users?page=1&selectedManagerId='+ids.manager)
    expect(body.items.map((item: {id:string}) => item.id)).toEqual([ids.foreign])
    expect(body.selectedManager).toBeNull()
  } finally {
    await fixture.admin.query('UPDATE users SET is_active=true WHERE id=$1', [ids.employee])
    await fixture.admin.query("UPDATE users SET role='manager' WHERE id=$1", [ids.manager])
    await fixture.admin.query('UPDATE users SET company_id=$2 WHERE id=$1', [fixture.hr, fixture.company])
  }
})

test('the web server uses the actual non-owner LOGIN and direct SQL cannot see another company', async () => {
  const { rows: [identity] } = await fixture.runtime.query(`SELECT current_user,session_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`)
  expect(identity).toMatchObject({ current_user: 'expense_web', session_user: 'expense_web', rolsuper: false, rolbypassrls: false })
  const connection = await fixture.runtime.connect()
  try {
    await connection.query('BEGIN')
    await connection.query("SELECT set_config('app.current_user_id',$1,true)", [fixture.hr])
    expect((await connection.query('SELECT count(*)::int AS count FROM users WHERE company_id=$1', [foreignCompany])).rows[0].count).toBe(0)
    expect((await connection.query('SELECT count(*)::int AS count FROM expense_notes WHERE user_id=$1', [ids.foreign])).rows[0].count).toBe(0)
    await connection.query('COMMIT')
  } catch (error) { await connection.query('ROLLBACK'); throw error } finally { connection.release() }
})
