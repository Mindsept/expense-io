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
import { hrPendingExpenseSource } from '../../../../src/lib/pending-expense-source'

// MATH-05 geometry/protocol, received from published commit24ab0c1.
// This new campaign explicitly measures pages, not the historical legacy lists.
readTestTarget()
const password = readTestIdentity('EMPLOYEE').password
const migrationFile = 'proposals/LE-09/1793000000000_leandro_expense_list_index.sql'
const migration = readFileSync(migrationFile, 'utf8')
const up = migration.split('-- Down Migration')[0].replace('-- Up Migration', '')
const down = migration.split('-- Down Migration')[1]
const protocol = 'math05-v3-limited-runtime-20261023'
if (process.env.LE09_MEASURE && process.env.LE09_MEASURE !== '1') throw new Error('LE09_MEASURE must be absent or 1')
const measuring = process.env.LE09_MEASURE === '1'
const passes = measuring ? 3 : 1, requestsPerPass = measuring ? 30 : 1, concurrency = measuring ? 4 : 1
const output = '.ci-output/le09'
type Sample = { pass: number; index: number; ms: number; status: number | null; bytes: number; ok: boolean; error: string | null }
let fixture: Awaited<ReturnType<typeof runtimeFixture>>
test.beforeAll(async () => { test.setTimeout(60_000); fixture = await runtimeFixture(3159) })
test.afterAll(async () => { await fixture?.close() })
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function summary(samples: Sample[]) {
  const median = (values: number[]) => { const v = [...values].sort((a,b)=>a-b); return (v[Math.floor((v.length-1)/2)]+v[Math.floor(v.length/2)])/2 }
  const values = samples.map(value => value.ms).sort((a,b) => a-b)
  return { attempts: samples.length, errors: samples.filter(value => !value.ok).length,
    medianMs: median(values), p95Ms: values.length >= 30 ? values[Math.ceil(values.length * .95)-1] : null,
    passMediansMs: Array.from({ length: passes }, (_,index) => median(samples.filter(value => value.pass === index+1).map(value => value.ms))) }
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
  const initialIndex = (await fixture.admin.query("SELECT to_regclass('public.leandro_expense_owner_status_idx') IS NOT NULL AS present")).rows[0].present as boolean
  let indexed = initialIndex, outcome = 'failed'
  const conditions = { protocol, adaptation: 'LE-09 pages20; actual queryPage SQL; private runtimeFixture database; no OCR or S3 receipts in this list experiment',
    source: execFileSync('git', ['rev-parse','HEAD'], { encoding: 'utf8' }).trim(),
    hashes: Object.fromEntries([migrationFile,'src/lib/pagination.ts','src/lib/expense-access.ts','src/lib/pending-expense-source.ts','package-lock.json','tests/api/leandro/LE-09/indexes.spec.ts',...['expense-notes','manager/expense-notes','hr/expense-notes'].map(p => `src/app/api/${p}/route.ts`)].map(file => [file,createHash('sha256').update(readFileSync(file)).digest('hex')])),
    node: process.version, platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model,
    memoryBytes: os.totalmem(), load: os.loadavg(), caches: 'warm/uncontrolled; 3 warmups per route and phase; shared machine, no production SLO',
    volume, mode: measuring ? 'repeated measurement' : 'functional regression (no latency conclusion)', concurrency, passes, requestsPerPass, page: 1, pageSize: 20 }
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
    Object.assign(conditions, { db: role, fixture: 'one private company, MATH-05 three roles plus fixture HR; generated notes only; fresh UUIDs/passwords' })
    expect(role).toMatchObject({ current_user: 'expense_web', session_user: 'expense_web', rolsuper: false, rolbypassrls: false })
    expect(Number((await fixture.runtime.query('SELECT count(*) FROM expense_notes')).rows[0].count)).toBe(0)
    const unchanged = await fingerprint(), bodies = new Map<string,string>()
    const definitions = [
      { name: 'employee', url: '/api/expense-notes', expected: volume/2, sourceSql: 'SELECT * FROM expense_notes WHERE user_id = $1', values: [users.employee], direction: 'DESC' as const },
      { name: 'manager', url: '/api/manager/expense-notes', expected: volume*.4, sourceSql: `SELECT en.*, u.name AS author_name FROM expense_notes en JOIN users u ON u.id=en.user_id WHERE ${expenseValidatorSql('manager',1,2)} AND en.status='pending'`, values: [users.manager,fixture.company], direction: 'ASC' as const },
      { name: 'hr', url: '/api/hr/expense-notes', expected: volume*.3, sourceSql: hrPendingExpenseSource(), values: [users.hr,fixture.company], direction: 'ASC' as const },
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
        for (let i=0;i<(measuring ? 3 : 0);i++) warmups.push(await measure(0,i))
        for (let pass=1;pass<=passes;pass++) {
          let next = 0
          await Promise.all(Array.from({ length: concurrency }, async () => { while (next<requestsPerPass) { const index = next++; samples.push(await measure(pass,index)) } }))
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
        const paired: { variant: string; repeat: number; ms: number; plan: unknown }[] = []
        if (definition.name === 'hr') {
          const reference = `SELECT en.*, u.name AS author_name FROM expense_notes en JOIN users u ON u.id=en.user_id WHERE ${expenseValidatorSql('hr_admin',1,2)} AND en.status='pending'`
          for (let repeat=0;repeat<(measuring ? 3 : 1);repeat++) {
            let referenceBody: unknown, candidateBody: unknown
            for (const variant of repeat%2 ? ['candidate','reference'] : ['reference','candidate']) {
              await fixture.runtime.query('BEGIN')
              try {
                await fixture.runtime.query("SELECT set_config('app.current_user_id',$1,true)", [users[definition.name as keyof typeof users]])
                const input = { sourceSql: variant === 'reference' ? reference : definition.sourceSql, values: definition.values, page: { page: 1, pageSize: 20, offset: 0 }, order: { column: 'created_at' as const, direction: definition.direction }, monetary: true }
                let pairedPlan: unknown
                await queryPage({ query: (async (sql: string, values: unknown[]) => {
                  pairedPlan = (await fixture.runtime.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql,values)).rows[0]['QUERY PLAN']
                  return { rows: [{ items: [], total_count: '0', total_cents: '0' }] }
                }) as never }, input)
                const result = await queryPage(fixture.runtime, input)
                if (variant === 'reference') referenceBody = result; else candidateBody = result
                paired.push({ variant,repeat,ms:(pairedPlan as { 'Execution Time': number }[])[0]['Execution Time'],plan:pairedPlan })
              } finally { await fixture.runtime.query('ROLLBACK') }
            }
            expect(candidateBody).toEqual(referenceBody)
          }
        }
        scenarios.push({ name: definition.name, ...summary(samples), samples, warmups, plan, paired })
        expect(samples.filter(sample => !sample.ok)).toEqual([]); expect(warmups.every(sample => sample.ok)).toBe(true)
      }
      phases.push({ phase, scenarios, fingerprint: unchanged, indexBytes: Number((await fixture.admin.query("SELECT coalesce(pg_relation_size(to_regclass('public.leandro_expense_owner_status_idx')),0) AS size")).rows[0].size) })
    }
    await fixture.admin.query(up); indexed = true
    expect(await fingerprint()).toEqual(unchanged)
    await assertRuntimeDatabase(fixture.runtime, { DATABASE_URL: fixture.runtimeURL })
    if (!initialIndex) { await fixture.admin.query(down); indexed = false }
    outcome = 'passed'
  } finally {
    try {
    await Promise.all(contexts.map(context => context.dispose()))
    if (indexed !== initialIndex) await fixture.admin.query(initialIndex ? up : down)
    await fixture.admin.query('DELETE FROM expense_notes WHERE user_id=ANY($1::uuid[])', [Object.values(users)])
    await fixture.admin.query('UPDATE users SET manager_id=NULL WHERE id=ANY($1::uuid[])', [Object.values(users)])
    await fixture.admin.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [Object.values(users)])
    } catch (error) { outcome = 'cleanup-failed'; throw error }
    finally { writeFileSync(`${output}/${volume}.json`, JSON.stringify({ outcome,conditions,phases },null,2)+'\n') }
  }
})

test('fanout: 100 eligible authors preserve results; compare reference and lateral query with and without the candidate index', async () => {
  test.setTimeout(120_000)
  const hashValue = await bcrypt.hash(password,4)
  const authors = (await fixture.admin.query(`INSERT INTO users(id,company_id,name,email,password_hash,role)
    SELECT gen_random_uuid(),$1,'LE09 fanout',gen_random_uuid()||'@example.test',$2,'manager' FROM generate_series(1,100) RETURNING id`, [fixture.company,hashValue])).rows.map(row=>row.id)
  const initial = (await fixture.admin.query("SELECT to_regclass('public.leandro_expense_owner_status_idx') IS NOT NULL AS present")).rows[0].present
  let indexed = initial, outcome = 'failed'
  const observations: { variant: string; repeat: number; ms: number; plan: unknown }[] = []
  const reference = `SELECT en.*,u.name AS author_name FROM expense_notes en JOIN users u ON u.id=en.user_id WHERE ${expenseValidatorSql('hr_admin',1,2)} AND en.status='pending'`
  try {
    await fixture.admin.query(`INSERT INTO expense_notes(user_id,amount,expense_date,description,receipt_key,status,created_at)
      SELECT ($1::uuid[])[1+(i%100)],12.50,DATE '2026-01-01','LE09 fanout','benchmark/no-receipt',
      CASE WHEN i%10<7 THEN 'pending' WHEN i%10<9 THEN 'approved' ELSE 'rejected' END,
      TIMESTAMPTZ '2026-01-01 12:00:00+00'+i*INTERVAL '1 minute' FROM generate_series(1,10000) i`, [authors])
    const unchanged = await fingerprint()
    let expected: unknown
    for (let repeat=0;repeat<3;repeat++) {
      for (const variant of repeat%2 ? ['indexed','lateral','reference'] : ['reference','lateral','indexed']) {
        const wanted = variant === 'indexed'
        if (wanted !== indexed) { await fixture.admin.query(wanted ? up : down); indexed = wanted }
        await fixture.admin.query('ANALYZE expense_notes'); await fixture.admin.query('ANALYZE users')
        await fixture.runtime.query('BEGIN')
        try {
          await fixture.runtime.query("SELECT set_config('app.current_user_id',$1,true)",[fixture.hr])
          const input = { sourceSql: variant === 'reference' ? reference : hrPendingExpenseSource(), values: [fixture.hr,fixture.company], page: { page: 1, pageSize: 20, offset: 0 }, order: { column: 'created_at' as const, direction: 'ASC' as const }, monetary: true }
          let plan: unknown
          await queryPage({query:(async (sql: string,values: unknown[])=>{
            plan=(await fixture.runtime.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql,values)).rows[0]['QUERY PLAN']
            return {rows:[{items:[],total_count:'0',total_cents:'0'}]}
          }) as never},input)
          const body = await queryPage(fixture.runtime,input)
          expect(body.pagination.totalItems).toBe(7000); expect(body.rows).toHaveLength(20)
          if (expected === undefined) expected = body; else expect(body).toEqual(expected)
          observations.push({variant,repeat,ms:(plan as {'Execution Time':number}[])[0]['Execution Time'],plan})
        } finally { await fixture.runtime.query('ROLLBACK') }
        expect(await fingerprint()).toEqual(unchanged)
      }
    }
    outcome = 'passed'
  } finally {
    if (indexed !== initial) await fixture.admin.query(initial ? up : down)
    await fixture.admin.query('DELETE FROM expense_notes WHERE user_id=ANY($1::uuid[])',[authors])
    await fixture.admin.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[authors])
    writeFileSync(`${output}/fanout.json`,JSON.stringify({source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),outcome,authors:100,notes:10000,observations},null,2)+'\n')
  }
})
