import { randomUUID, randomBytes } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { expect, test, type APIRequestContext } from '@playwright/test'
import bcrypt from 'bcryptjs'
import { runner } from 'node-pg-migrate'
import { assertRuntimeDatabase } from '../../../../src/lib/runtime-database'
import type { PoolClient } from 'pg'
import { runtimeFixture } from '../../../contracts/hamza/HA-04/runtime-fixture'
import { withUserScope } from '../../../../src/lib/db'
import { issueEmployeeInvitation, redeemInvitation } from '../../../../src/lib/enrollment/runtime'

let fixture: Awaited<ReturnType<typeof runtimeFixture>>
const ids = Object.fromEntries(['employee','manager','foreign','foreignManager','peerHr'].map(key=>[key,randomUUID()]))
const otherCompany = randomUUID(), contexts: APIRequestContext[] = []
let password: string

test.beforeAll(async ({playwright}) => {
  fixture = await runtimeFixture()
  password = randomBytes(24).toString('base64url')
  await fixture.admin.query("INSERT INTO companies(id,name,email_domain) VALUES($1,'Foreign',$2)",[otherCompany,`${otherCompany}.test`])
  const hash=await bcrypt.hash(password,4)
  for (const [key,id] of Object.entries(ids)) await fixture.admin.query('INSERT INTO users(id,company_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5,$6)',[id,key.startsWith('foreign')?otherCompany:fixture.company,key,`${id}@example.test`,hash,key==='peerHr'?'hr_admin':key.toLowerCase().includes('manager')?'manager':'employee'])
  await fixture.admin.query('UPDATE users SET manager_id=$1 WHERE id=$2',[ids.manager,ids.employee])
  for (const id of [ids.employee,ids.manager,ids.foreignManager,fixture.hr]) {
    const client=await playwright.request.newContext({baseURL:fixture.baseURL});contexts.push(client)
    const csrf=await(await client.get('/api/auth/csrf')).json()
    await client.post('/api/auth/callback/credentials',{form:{csrfToken:csrf.csrfToken,email:id===fixture.hr?fixture.hrEmail:`${id}@example.test`,password:id===fixture.hr?fixture.password:password,callbackUrl:`${fixture.baseURL}/expenses`},maxRedirects:0})
    expect((await(await client.get('/api/auth/session')).json()).user.id).toBe(id)
  }
})
test.afterAll(async () => { await Promise.all(contexts.map(client=>client.dispose()));await fixture?.close() })
async function scope<T>(id: string, operation: (client: PoolClient)=>Promise<T>) {
  const client=await fixture.runtime.connect()
  try { await client.query('BEGIN');await client.query("SELECT set_config('app.current_user_id',$1,true)",[id]);const result=await operation(client);await client.query('COMMIT');return result }
  catch(error) {await client.query('ROLLBACK');throw error} finally {client.release()}
}

test('the real login is unprivileged, owns no tables and has no context-free business access', async () => {
  const {rows:[role]}=await fixture.runtime.query('SELECT current_user AS role,session_user AS login,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')
  expect(role).toEqual({role:'expense_web',login:'expense_web',rolsuper:false,rolbypassrls:false,rolcreatedb:false,rolcreaterole:false})
  for (const table of ['users','companies','expense_notes','expense_decision_history','management_changes','expense_submission_operations','expense_submission_attempts','enrollment_invitations']) {
    expect((await fixture.runtime.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count).toBe(0)
  }
  await expect(fixture.runtime.query('SELECT password_hash FROM users')).rejects.toMatchObject({code:'42501'})
  await expect(fixture.runtime.query('SET ROLE expense_identity')).rejects.toMatchObject({code:'42501'})
  await expect(fixture.runtime.query('CREATE TABLE public.forbidden(id int)')).rejects.toMatchObject({code:'42501'})
  await expect(fixture.runtime.query('ALTER TABLE users DISABLE ROW LEVEL SECURITY')).rejects.toMatchObject({code:'42501'})
  await expect(fixture.runtime.query('TRUNCATE expense_notes')).rejects.toMatchObject({code:'42501'})
  expect(Number((await fixture.admin.query("SELECT count(*) FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname='expense_web')")).rows[0].count)).toBe(0)
})

test('tenant reads, protected new values and HR changes use real RLS and column grants', async () => {
  await scope(ids.employee,async client=>{
    const users=await client.query('SELECT id,company_id FROM users')
    expect(users.rows.some(row=>row.id===ids.employee)).toBe(true)
    expect(users.rows.every(row=>row.company_id===fixture.company)).toBe(true)
    expect((await client.query('SELECT id FROM companies')).rows).toEqual([{id:fixture.company}])
    expect((await client.query('SELECT id FROM users WHERE company_id=$1',[otherCompany])).rowCount).toBe(0)
    await client.query('SELECT id FROM users WHERE id=$1 FOR SHARE',[ids.employee])
  })
  await expect(scope(ids.employee,client=>client.query("UPDATE users SET role='hr_admin' WHERE id=$1",[ids.employee]))).rejects.toMatchObject({code:'42501'})
  await expect(scope(ids.employee,client=>client.query('UPDATE users SET company_id=$1 WHERE id=$2',[otherCompany,ids.employee]))).rejects.toMatchObject({code:'42501'})
  await expect(scope(ids.employee,client=>client.query("INSERT INTO expense_notes(user_id,amount,expense_date,description,receipt_key) VALUES($1,12,'2026-10-23','forged','fixture')",[ids.foreign]))).rejects.toMatchObject({code:'42501'})
  await expect(scope(ids.employee,client=>client.query("INSERT INTO expense_submission_operations(user_id,company_id,intent_key,fingerprint) VALUES($1,$2,$3,$4)",[ids.employee,otherCompany,randomUUID(),'f'.repeat(64)]))).rejects.toMatchObject({code:'42501'})
  const changed=await scope(fixture.hr,client=>client.query("UPDATE users SET role='manager' WHERE id=$1 RETURNING id",[ids.employee]))
  expect(changed.rowCount).toBe(1)
  await fixture.admin.query("UPDATE users SET role='employee' WHERE id=$1",[ids.employee])
  expect((await scope(fixture.hr,client=>client.query("UPDATE users SET role='manager' WHERE id=$1",[ids.foreign]))).rowCount).toBe(0)
  await expect(scope(fixture.hr,client=>client.query("INSERT INTO management_changes(company_id,actor_id,target_id,from_role,to_role,from_active,to_active) VALUES($1,$2,$3,'employee','manager',true,true)",[fixture.company,fixture.hr,ids.foreign]))).rejects.toMatchObject({code:'42501'})

})

test('real HTTP submission, idempotent replay, receipts, decision/history and current-rights revocation work under expense_web', async () => {
  const key=randomUUID()
  const submit=()=>contexts[0].post('/api/expense-notes',{headers:{'Idempotency-Key':key},multipart:{amount:'12.50',expenseDate:'2026-10-23',description:'Limited runtime',receipt:{name:'fixture.png',mimeType:'image/png',buffer:readFileSync('tests/fixtures/leandro/LE-01/valid.png')}}})
  const created=await submit();expect(created.status()).toBe(201)
  const note=await created.json()
  const replay=await submit();expect(replay.status()).toBe(201);expect(replay.headers()['idempotency-replayed']).toBe('true');expect((await replay.json()).id).toBe(note.id)
  expect((await contexts[0].get(`/api/expense-notes/${note.id}/receipt-url`)).status()).toBe(200)
  expect((await contexts[1].get(`/api/manager/expense-notes/${note.id}/receipt-url`)).status()).toBe(200)
  expect((await contexts[2].get(`/api/manager/expense-notes/${note.id}/receipt-url`)).status()).toBe(404)
  const decision=await contexts[1].post(`/api/manager/expense-notes/${note.id}/approve`)
  expect(decision.status()).toBe(200)
  const history=await contexts[0].get(`/api/expense-notes/${note.id}/history`)
  expect(history.status()).toBe(200)
  expect(JSON.stringify(await history.json())).toContain('approved')
  expect((await contexts[0].get(`/api/expense-notes/${note.id}/validation-status`)).status()).toBe(200)
  expect((await contexts[3].get('/api/hr/users')).status()).toBe(200)
  await fixture.admin.query('UPDATE users SET is_active=false WHERE id=$1',[ids.manager])
  expect((await contexts[1].get('/api/manager/expense-notes')).status()).toBe(401)
  await fixture.admin.query('UPDATE users SET is_active=true WHERE id=$1',[ids.manager])
})

test('pool context is cleared after commit and rollback before reusing the same connection', async () => {
  const previous=globalThis.__pgPool
  globalThis.__pgPool=fixture.runtime
  try {
    const first=await withUserScope(ids.employee,async client=>{
      expect((await client.query('SELECT count(*)::int AS count FROM users')).rows[0].count).toBeGreaterThan(0)
      return (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    })
    expect((await fixture.runtime.query('SELECT count(*)::int AS count FROM users')).rows[0].count).toBe(0)
    await expect(withUserScope(ids.employee,async client=>{await client.query('SELECT id FROM users');throw Error('injected rollback')})).rejects.toThrow('injected rollback')
    expect((await fixture.runtime.query('SELECT count(*)::int AS count FROM users')).rows[0].count).toBe(0)
    expect((await fixture.runtime.query('SELECT pg_backend_pid() AS pid')).rows[0].pid).toBe(first)
  } finally {globalThis.__pgPool=previous}
})

test('narrow pre-authentication capabilities require both proofs and cannot reuse or reaffiliate an account', async () => {
  const email=`${randomUUID()}@public-domain.test`
  const issued=await issueEmployeeInvitation(fixture.runtime,fixture.hr,{email,ttlSeconds:3600})
  const input={token:issued.token,emailProof:issued.proofToken,name:'Restricted invited',password:randomBytes(24).toString('base64url')}
  await expect(redeemInvitation(fixture.runtime,{...input,emailProof:randomBytes(32).toString('base64url')})).rejects.toMatchObject({code:'invitation_unavailable'})
  const outcomes=await Promise.allSettled([redeemInvitation(fixture.runtime,input),redeemInvitation(fixture.runtime,input)])
  expect(outcomes.filter(result=>result.status==='fulfilled')).toHaveLength(1)
  expect(outcomes.filter(result=>result.status==='rejected')).toHaveLength(1)
  const account=(await fixture.admin.query('SELECT company_id,role FROM users WHERE email=$1',[email])).rows
  expect(account).toEqual([{company_id:fixture.company,role:'employee'}])
  const existing=await issueEmployeeInvitation(fixture.runtime,fixture.hr,{email:`${ids.foreign}@example.test`,ttlSeconds:3600})
  await expect(redeemInvitation(fixture.runtime,{token:existing.token,emailProof:existing.proofToken,name:'No transfer',password:input.password})).rejects.toMatchObject({code:'account_exists'})
  expect((await fixture.admin.query('SELECT company_id FROM users WHERE id=$1',[ids.foreign])).rows[0].company_id).toBe(otherCompany)
})


test('current HR access changes and self-demotion remain usable while history stays append-only', async () => {
  const hr=contexts[3]
  try {
    const changed=await hr.put(`/api/hr/users/${ids.employee}/access`,{data:{role:'manager'}})
    expect(changed.status()).toBe(200)
    expect((await contexts[0].get('/api/manager/expense-notes')).status()).toBe(200)
    expect((await fixture.admin.query('SELECT actor_id FROM management_changes WHERE target_id=$1',[ids.employee])).rows[0].actor_id).toBe(fixture.hr)
    await fixture.admin.query('UPDATE users SET is_active=false WHERE id=$1',[ids.peerHr])
    expect((await hr.put(`/api/hr/users/${fixture.hr}/access`,{data:{role:'employee'}})).status()).toBe(409)
    await fixture.admin.query('UPDATE users SET is_active=true WHERE id=$1',[ids.peerHr])
    expect((await hr.put(`/api/hr/users/${fixture.hr}/access`,{data:{role:'employee'}})).status()).toBe(200)
    expect((await hr.get('/api/hr/users')).status()).toBe(403)
    await expect(scope(ids.employee,client=>client.query('UPDATE expense_decision_history SET actor_display_name=$1',['forged']))).rejects.toMatchObject({code:'42501'})
    await expect(scope(ids.employee,client=>client.query('DELETE FROM management_changes'))).rejects.toMatchObject({code:'42501'})
  } finally {
    await fixture.admin.query("UPDATE users SET role='employee' WHERE id=$1",[ids.employee])
    await fixture.admin.query("UPDATE users SET role='hr_admin',is_active=true WHERE id=$1",[fixture.hr])
    await fixture.admin.query('UPDATE users SET is_active=true WHERE id=$1',[ids.peerHr])
  }
})

test('an expiry after account insertion rolls the real restricted SQL function back atomically', async () => {
  const email=`${randomUUID()}@rollback.test`
  const issued=await issueEmployeeInvitation(fixture.runtime,fixture.hr,{email,ttlSeconds:3600})
  await fixture.admin.query("UPDATE enrollment_invitations SET created_at=clock_timestamp()-interval '2 days' WHERE id=$1",[issued.invitationId])
  const trigger=`ha04_expire_${randomUUID().replaceAll('-','')}`
  try {
    await fixture.admin.query(`CREATE FUNCTION public.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $body$ BEGIN IF NEW.email='${email}' THEN UPDATE public.enrollment_invitations SET expires_at=clock_timestamp()-interval '1 second' WHERE intended_email=NEW.email; END IF; RETURN NEW; END $body$`)
    await fixture.admin.query(`CREATE TRIGGER ${trigger} AFTER INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION public.${trigger}()`)
    await expect(redeemInvitation(fixture.runtime,{token:issued.token,emailProof:issued.proofToken,name:'Rollback',password:randomBytes(24).toString('base64url')})).rejects.toMatchObject({code:'invitation_unavailable'})
    expect((await fixture.admin.query('SELECT id FROM users WHERE email=$1',[email])).rows).toEqual([])
    expect((await fixture.admin.query('SELECT consumed_at,consumed_by FROM enrollment_invitations WHERE id=$1',[issued.invitationId])).rows).toEqual([{consumed_at:null,consumed_by:null}])
  } finally {await fixture.admin.query(`DROP TRIGGER IF EXISTS ${trigger} ON public.users;DROP FUNCTION IF EXISTS public.${trigger}()`)}
})

test('the actual startup guard rejects dangerous grants and unreviewed callable SECURITY DEFINER functions', async () => {
  const env={DATABASE_URL:fixture.runtimeURL}
  await expect(assertRuntimeDatabase(fixture.runtime,env)).resolves.toBeUndefined()
  try {
    await fixture.admin.query('GRANT SELECT(password_hash) ON public.users TO expense_web')
    await expect(assertRuntimeDatabase(fixture.runtime,env)).rejects.toThrow('Database isolation check failed.')
  } finally {await fixture.admin.query('REVOKE SELECT(password_hash) ON public.users FROM expense_web')}
  const fn=`ha04_unreviewed_${randomUUID().replaceAll('-','')}`
  try {
    await fixture.admin.query(`CREATE FUNCTION public.${fn}() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS 'SELECT 1'`)
    await expect(assertRuntimeDatabase(fixture.runtime,env)).rejects.toThrow('Database isolation check failed.')
  } finally {await fixture.admin.query(`DROP FUNCTION IF EXISTS public.${fn}()`)}
  await expect(assertRuntimeDatabase(fixture.runtime,env)).resolves.toBeUndefined()
})

test('real migration down fails closed and up restores isolation without changing business data', async () => {
  await fixture.stopWeb()
  const tables=['users','companies','expense_notes','expense_decision_history','management_changes','expense_submission_operations','expense_submission_attempts','enrollment_invitations']
  const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await fixture.admin.query(`SELECT * FROM ${table} ORDER BY id`)).rows])))
  const before=await snapshot(),quiet=()=>{}
  const options={databaseUrl:fixture.adminURL,dir:'migrations',migrationsTable:'pgmigrations',checkOrder:true,singleTransaction:true,logger:{debug:quiet,info:quiet,warn:quiet,error:quiet}}
  const rollbackCount=readdirSync('migrations').filter(name=>name.endsWith('.sql')&&Number(name.split('_')[0])>=1792764001000).length
  expect(await runner({...options,direction:'down',count:rollbackCount})).toHaveLength(rollbackCount)
  expect(await snapshot()).toEqual(before)
  await expect(fixture.runtime.query('SELECT id FROM users')).rejects.toMatchObject({code:'42501'})
  expect(await runner({...options,direction:'up'})).toHaveLength(rollbackCount)
  expect(await snapshot()).toEqual(before)
  await expect(assertRuntimeDatabase(fixture.runtime,{DATABASE_URL:fixture.runtimeURL})).resolves.toBeUndefined()
})
