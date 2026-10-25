import { randomUUID, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import bcrypt from 'bcryptjs'
import { test, expect, type APIRequestContext } from '@playwright/test'
import { runtimeFixture } from '../../../contracts/hamza/HA-04/runtime-fixture'
import { readTestTarget, readTestIdentity } from '../../../support/test-target'
import { assertRuntimeDatabase } from '../../../../src/lib/runtime-database'
import { queryPage } from '../../../../src/lib/pagination'
import { expenseValidatorSql } from '../../../../src/lib/expense-access'

// MATH-05 geometry/protocol, received from published commit24ab0c1.
// This new campaign explicitly measures pages, not the historical legacy lists.
readTestTarget()
const password = readTestIdentity('EMPLOYEE').password
const migrationFile = 'migrations/1793000000000_leandro_expense_list_index.sql'
const migration = readFileSync(migrationFile, 'utf8')
const up = migration.split('-- Down Migration')[0].replace('-- Up Migration', '')
const down = migration.split('-- Down Migration')[1]
const protocol = 'math05-v3-limited-runtime-20261023'
const output = '.ci-output/le09'
type Sample = { pass: number; index: number; ms: number; status: number | null; bytes: number; ok: boolean; error: string | null }
let fixture: Awaited<ReturnType<typeof runtimeFixture>>
test.beforeAll(async () => { test.setTimeout(60_000); fixture = await runtimeFixture(3159) })
test.afterAll(async () => { await fixture?.close() })
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function summary(samples: Sample[]) {
  const values = samples.map(value => value.ms).sort((a,b) => a-b)
  return { attempts: samples.length, errors: samples.filter(value => !value.ok).length,
    medianMs: (values[44] + values[45]) / 2, p95Ms: values[Math.ceil(values.length * .95)-1],
    passMediansMs: [1,2,3].map(pass => { const v = samples.filter(value => value.pass === pass).map(value => value.ms).sort((a,b)=>a-b); return (v[14]+v[15])/2 }) }
}
async function fingerprint() {
  const data = (await fixture.admin.query(`SELECT count(*)::int AS count,
    md5(string_agg(concat(id,'|',user_id,'|',amount,'|',expense_date,'|',description,'|',receipt_key,'|',status,'|',created_at),E'\n' ORDER BY id)) AS digest FROM expense_notes`)).rows[0]
  const policies = (await fixture.admin.query(`SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname`)).rows
  const grants = (await fixture.admin.query(`SELECT table_name,column_name,privilege_type FROM information_schema.column_privileges WHERE grantee='expense_web' ORDER BY table_name,column_name,privilege_type`)).rows
  return { data, policies: hash(policies), grants: hash(grants) }
}

for (const volume of [1000, 10000]) test(`${volume}: bounded lists preserve results and permissions through index up/down/up, with real limited-role plans`, async ({ playwright }) => {
  test.setTimeout(240_000)
  const users = { employee: randomUUID(), manager: randomUUID(), hr: randomUUID() }
  const contexts: APIRequestContext[] = [], phases: Record<string, unknown>[] = []
  let indexed = true, outcome = 'failed'
  const conditions = { protocol, adaptation: 'LE-09 pages20; actual queryPage SQL; private runtimeFixture database; no OCR or S3 receipts in this list experiment',
    source: execFileSync('git', ['rev-parse','HEAD'], { encoding: 'utf8' }).trim(),
    hashes: Object.fromEntries([migrationFile,'src/lib/pagination.ts','src/lib/expense-access.ts','package-lock.json','tests/api/leandro/LE-09/indexes.spec.ts',...['expense-notes','manager/expense-notes','hr/expense-notes'].map(p => `src/app/api/${p}/route.ts`)].map(file => [file,createHash('sha256').update(readFileSync(file)).digest('hex')])),
    node: process.version, platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model,
    memoryBytes: os.totalmem(), load: os.loadavg(), caches: 'warm/uncontrolled; 3 warmups per route and phase; shared machine, no production SLO',
    volume, concurrency: 4, passes: 3, requestsPerPass: 30, page: 1, pageSize: 20 }
  mkdirSync(output, { recursive: true })
  try {
    const storedHash = await bcrypt.hash(password, 4)
    for (const role of ['manager','employee','hr'] as const) await fixture.admin.query(
      'INSERT INTO users(id,company_id,name,email,password_hash,role,manager_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [users[role],fixture.company,`MATH05 ${role.toUpperCase()}`,`${users[role]}@example.test`,storedHash,role === 'hr' ? 'hr_admin' : role,role === 'employee' ? users.manager : null])
    // Identical deterministic amounts, dates, status and owner geometry to MATH-05.
    await fixture.admin.query(`INSERT INTO expense_notes(user_id,amount,expense_date,description,receipt_key,status,created_at)
      SELECT CASE WHEN i%2=0 THEN $1::uuid ELSE $2::uuid END,
      (100+(i*7919)%99000)::numeric/100, DATE '2026-01-01'+(i%280), $3||':'||i, 'benchmark/no-receipt',
      CASE WHEN i%10<7 THEN 'pending' WHEN i%10<9 THEN 'approved' ELSE 'rejected' END,
      TIMESTAMPTZ '2026-01-01 12:00:00+00'+i*INTERVAL '1 minute' FROM generate_series(1,$4::int) i`,
    [users.employee,users.manager,protocol,volume])
    await assertRuntimeDatabase(fixture.runtime, { DATABASE_URL: fixture.runtimeURL })
    const role = (await fixture.runtime.query('SELECT current_user,session_user,rolsuper,rolbypassrls,version() FROM pg_roles WHERE rolname=current_user')).rows[0]
    expect(role).toMatchObject({ current_user: 'expense_web', session_user: 'expense_web', rolsuper: false, rolbypassrls: false })
    expect(Number((await fixture.runtime.query('SELECT count(*) FROM expense_notes')).rows[0].count)).toBe(0)
    const unchanged = await fingerprint(), bodies = new Map<string,string>()
    const definitions = [
      { name: 'employee', url: '/api/expense-notes', expected: volume/2, sourceSql: 'SELECT * FROM expense_notes WHERE user_id = $1', values: [users.employee], direction: 'DESC' as const },
      { name: 'manager', url: '/api/manager/expense-notes', expected: volume*.4, sourceSql: `SELECT en.*, u.name AS author_name FROM expense_notes en JOIN users u ON u.id = en.user_id WHERE ${expenseValidatorSql('manager',1,2)} AND en.status = 'pending'`, values: [users.manager,fixture.company], direction: 'ASC' as const },
      { name: 'hr', url: '/api/hr/expense-notes', expected: volume*.3, sourceSql: `SELECT en.*, u.name AS author_name FROM expense_notes en JOIN users u ON u.id = en.user_id WHERE ${expenseValidatorSql('hr_admin',1,2)} AND en.status = 'pending'`, values: [users.hr,fixture.company], direction: 'ASC' as const },
    ]
    const anonymous = await playwright.request.newContext({ baseURL: fixture.baseURL }); contexts.push(anonymous)
    const denied = await anonymous.get('/api/expense-notes'); expect(denied.status()).toBe(401); await denied.dispose()
    for (const definition of definitions) {
      const client = await playwright.request.newContext({ baseURL: fixture.baseURL, timeout: 10000 }); contexts.push(client)
      const csrfResponse = await client.get('/api/auth/csrf'), csrf = await csrfResponse.json(); await csrfResponse.dispose()
      const login = await client.post('/api/auth/callback/credentials', { form: { csrfToken: csrf.csrfToken, email: `${users[definition.name as keyof typeof users]}@example.test`, password, callbackUrl: fixture.baseURL+'/expenses' }, maxRedirects: 0 })
      expect(login.status()).toBe(302); await login.dispose()
      Object.assign(definition, { client })
    }
    for (const phase of ['before','indexed','rollback']) {
      const wanted = phase === 'indexed'
      if (wanted !== indexed) { await fixture.admin.query(wanted ? up : down); indexed = wanted }
      expect((await fixture.admin.query("SELECT to_regclass('public.leandro_expense_owner_status_idx') IS NOT NULL AS present")).rows[0].present).toBe(wanted)
      await fixture.admin.query('ANALYZE expense_notes'); await fixture.admin.query('ANALYZE users')
      expect(await fingerprint()).toEqual(unchanged)
      const scenarios = []
      for (const definition of definitions) {
        const client = (definition as typeof definition & { client: APIRequestContext }).client
        const samples: Sample[] = [], warmups: Sample[] = []
        const measure = async (pass: number, index: number) => {
          const started = performance.now(); let response, status: number | null = null, bytes = 0, ok = false, error: string | null = null
          try {
            response = await client.get(`${definition.url}?page=1&pageSize=20`, { timeout: 10000 })
            status = response.status(); const buffer = await response.body(); bytes = buffer.length
            const body = JSON.parse(buffer.toString()), digest = hash(body)
            if (!bodies.has(definition.name)) bodies.set(definition.name,digest)
            ok = status === 200 && body.items?.length === 20 && body.pagination?.totalItems === definition.expected && body.totals?.count === definition.expected && digest === bodies.get(definition.name)
            if (!ok) error = 'status-or-result-mismatch'
          } catch { error = 'request-error' }
          const ms = performance.now()-started
          try { await response?.dispose() } catch { ok = false; error = 'response-cleanup-error' }
          return { pass,index,ms,status,bytes,ok,error }
        }
        for (let i=0;i<3;i++) warmups.push(await measure(0,i))
        for (let pass=1;pass<=3;pass++) {
          let next = 0
          await Promise.all(Array.from({ length: 4 }, async () => { while (next<30) { const index = next++; samples.push(await measure(pass,index)) } }))
        }
        // Capture the SQL built by the actual pagination helper, not a simplified query.
        let plan: unknown
        await fixture.runtime.query('BEGIN')
        try {
          await fixture.runtime.query("SELECT set_config('app.current_user_id',$1,true)", [users[definition.name as keyof typeof users]])
          await queryPage({ query: (async (sql: string, values: unknown[]) => {
            plan = (await fixture.runtime.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql,values)).rows[0]['QUERY PLAN']
            return { rows: [{ items: [], total_count: '0', total_cents: '0' }] }
          }) as never }, { sourceSql: definition.sourceSql, values: definition.values, page: { page: 1, pageSize: 20, offset: 0 }, order: { column: 'created_at', direction: definition.direction }, monetary: true })
        } finally { await fixture.runtime.query('ROLLBACK') }
        scenarios.push({ name: definition.name, ...summary(samples), samples, warmups, plan })
        expect(samples.filter(sample => !sample.ok)).toEqual([]); expect(warmups.every(sample => sample.ok)).toBe(true)
      }
      phases.push({ phase, scenarios, fingerprint: unchanged, indexBytes: Number((await fixture.admin.query("SELECT coalesce(pg_relation_size(to_regclass('public.leandro_expense_owner_status_idx')),0) AS size")).rows[0].size) })
    }
    await fixture.admin.query(up); indexed = true
    expect(await fingerprint()).toEqual(unchanged)
    await assertRuntimeDatabase(fixture.runtime, { DATABASE_URL: fixture.runtimeURL })
    outcome = 'passed'
  } finally {
    try {
    await Promise.all(contexts.map(context => context.dispose()))
    if (!indexed) await fixture.admin.query(up)
    await fixture.admin.query('DELETE FROM expense_notes WHERE user_id=ANY($1::uuid[])', [Object.values(users)])
    await fixture.admin.query('UPDATE users SET manager_id=NULL WHERE id=ANY($1::uuid[])', [Object.values(users)])
    await fixture.admin.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [Object.values(users)])
    } catch (error) { outcome = 'cleanup-failed'; throw error }
    finally { writeFileSync(`${output}/${volume}.json`, JSON.stringify({ outcome,conditions,phases },null,2)+'\n') }
  }
})
