import { randomBytes,randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import bcrypt from 'bcryptjs'
import { expect,test,type APIRequestContext } from '@playwright/test'
import type { Pool,PoolClient } from 'pg'
import { notificationFixture } from '../../../contracts/hamza/HA-09/runtime-fixture'
import { assertNotificationWorker,deliverOneDecisionNotification,deliverOneAssignment,scanAssignments,notificationInbox,markDecisionInboxRead,markAssignmentRead,PostgresInAppNotificationAdapter } from '../../../../src/lib/notifications/inbox'
let fixture:Awaited<ReturnType<typeof notificationFixture>>
const ids={owner:randomUUID(),manager:randomUUID(),replacement:randomUUID(),foreign:randomUUID()},foreignCompany=randomUUID()
let password:string
const contexts:APIRequestContext[]=[]
const policy={maxAttempts:2,retryDelaySeconds:0}
test.beforeAll(async({playwright})=>{
  fixture=await notificationFixture();password=randomBytes(24).toString('base64url')
  await fixture.admin.query("INSERT INTO companies(id,name,email_domain) VALUES($1,'Foreign',$2)",[foreignCompany,`${foreignCompany}.test`])
  for(const[key,id]of Object.entries(ids))await fixture.admin.query('INSERT INTO users(id,company_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5,$6)',[id,key==='foreign'?foreignCompany:fixture.company,key,`${id}@example.test`,await bcrypt.hash(password,4),key==='owner'?'employee':'manager'])
  await fixture.admin.query('UPDATE users SET manager_id=$1 WHERE id=$2',[ids.manager,ids.owner])
  for(const id of [ids.owner,ids.manager,ids.replacement,ids.foreign]){
    const client=await playwright.request.newContext({baseURL:fixture.baseURL});contexts.push(client)
    const csrf=await(await client.get('/api/auth/csrf')).json()
    await client.post('/api/auth/callback/credentials',{form:{csrfToken:csrf.csrfToken,email:`${id}@example.test`,password,callbackUrl:`${fixture.baseURL}/expenses`},maxRedirects:0})
    expect((await(await client.get('/api/auth/session')).json()).user.id).toBe(id)
  }
})
test.afterAll(async()=>{await Promise.all(contexts.map(context=>context.dispose()));await fixture?.close()})
async function scoped<T>(id:string,operation:(client:PoolClient,actor:{id:string;companyId:string;role:'employee'|'manager'|'hr_admin'})=>Promise<T>){
  const client=await fixture.runtime.connect()
  try{await client.query('BEGIN');await client.query("SELECT set_config('app.current_user_id',$1,true)",[id]);const role=id===ids.owner?'employee':id===fixture.hr?'hr_admin':'manager';const result=await operation(client,{id,companyId:id===ids.foreign?foreignCompany:fixture.company,role});await client.query('COMMIT');return result}
  catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
async function note(){
  const response=await contexts[0].post('/api/expense-notes',{multipart:{amount:'12.50',expenseDate:'2026-10-23',description:'Notification runtime',receipt:{name:'fixture.png',mimeType:'image/png',buffer:readFileSync('tests/fixtures/leandro/LE-01/valid.png')}}})
  expect(response.status()).toBe(201);return(await response.json()).id as string
}

test('the actual worker CLI delivers one assignment and rechecks current rights after reassignment',async()=>{
  const expense=await note()
  const first=await fixture.runWorker();expect(first.delivered).toBeGreaterThan(0)
  const inbox=await scoped(ids.manager,notificationInbox),assigned=inbox.find(item=>item.expenseId===expense)
  expect(assigned).toMatchObject({kind:'assignment',href:'/manager',readAt:null})
  expect((await scoped(ids.foreign,notificationInbox)).some(item=>item.expenseId===expense)).toBe(false)
  const marked=await scoped(ids.manager,(client,actor)=>markAssignmentRead(client,actor,assigned!.eventId));expect(marked?.readAt).toEqual(expect.any(String))
  const same=await scoped(ids.manager,(client,actor)=>markAssignmentRead(client,actor,assigned!.eventId));expect(same).toEqual(marked)
  await fixture.admin.query('UPDATE users SET manager_id=$1 WHERE id=$2',[ids.replacement,ids.owner])
  expect((await scoped(ids.manager,notificationInbox)).some(item=>item.expenseId===expense)).toBe(false)
  expect(await scoped(ids.manager,(client,actor)=>markAssignmentRead(client,actor,assigned!.eventId))).toBeNull()
  await fixture.runWorker()
  const replacement=(await scoped(ids.replacement,notificationInbox)).find(item=>item.expenseId===expense)
  expect(replacement).toMatchObject({kind:'assignment',href:'/manager',readAt:null})
  expect(replacement?.eventId===assigned?.eventId).toBe(false)
  await fixture.runWorker()
  expect((await scoped(ids.replacement,notificationInbox)).filter(item=>item.expenseId===expense)).toHaveLength(1)
  await fixture.admin.query('UPDATE users SET manager_id=$1 WHERE id=$2',[ids.manager,ids.owner])
})

test('channel outage cannot undo a real committed decision and explicit replay delivers once',async()=>{
  const expense=await note(),decision=await contexts[1].post(`/api/manager/expense-notes/${expense}/approve`)
  expect(decision.status()).toBe(200)
  const event=(await fixture.admin.query('SELECT event_id FROM decision_notification_outbox WHERE expense_id=$1',[expense])).rows[0].event_id
  const trigger=`ha09_fail_${randomUUID().replaceAll('-','')}`
  try{
    await fixture.admin.query(`CREATE FUNCTION public.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $body$ BEGIN RAISE EXCEPTION 'controlled inbox outage'; END $body$`)
    await fixture.admin.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON public.decision_inbox FOR EACH ROW EXECUTE FUNCTION public.${trigger}()`)
    expect((await deliverOneDecisionNotification(fixture.worker,policy)).outcome).toBe('retry')
    expect((await deliverOneDecisionNotification(fixture.worker,policy)).outcome).toBe('failed')
    expect((await fixture.admin.query('SELECT status FROM expense_notes WHERE id=$1',[expense])).rows[0].status).toBe('approved')
    expect((await fixture.admin.query('SELECT state,attempts FROM decision_notification_outbox WHERE event_id=$1',[event])).rows).toEqual([{state:'failed',attempts:2}])
  }finally{await fixture.admin.query(`DROP TRIGGER IF EXISTS ${trigger} ON decision_inbox;DROP FUNCTION IF EXISTS public.${trigger}()`)}
  expect(await fixture.runWorker(['--requeue','decision',event,foreignCompany])).toEqual({requeued:0})
  expect(await fixture.runWorker(['--requeue','decision',event,fixture.company])).toEqual({requeued:1})
  await fixture.runWorker();await fixture.runWorker()
  const inbox=(await scoped(ids.owner,notificationInbox)).filter(item=>item.eventId===event)
  expect(inbox).toHaveLength(1);expect(inbox[0]).toMatchObject({kind:'decision',decision:'approved',href:'/expenses',readAt:null})
  const marked=await scoped(ids.owner,(client,actor)=>markDecisionInboxRead(client,actor,event))
  await scoped(ids.owner,client=>client.query("UPDATE decision_inbox SET read_at='2099-01-01' WHERE event_id=$1",[event]))
  expect((await scoped(ids.owner,notificationInbox)).find(item=>item.eventId===event)?.readAt).toBe(marked?.readAt)
  expect(await fixture.runWorker(['--requeue','decision',event,fixture.company])).toEqual({requeued:0})
})

test('web and worker privileges prevent foreign reads, metadata rewrites and administrator fallback',async()=>{
  await expect(assertNotificationWorker(fixture.admin)).rejects.toThrow('limited notification worker')
  await expect(fixture.worker.query('SELECT password_hash FROM users')).rejects.toMatchObject({code:'42501'})
  await expect(fixture.worker.query('SELECT receipt_key,amount FROM expense_notes')).rejects.toMatchObject({code:'42501'})
  await expect(fixture.worker.query("UPDATE users SET role='hr_admin'")).rejects.toMatchObject({code:'42501'})
  await expect(fixture.worker.query('SET ROLE expense_web')).rejects.toMatchObject({code:'42501'})
  await expect(fixture.worker.query('TRUNCATE decision_inbox')).rejects.toMatchObject({code:'42501'})
  await expect(fixture.runtime.query('INSERT INTO assignment_notification_outbox(expense_id,company_id,recipient_id,generation) VALUES($1,$2,$3,1)',[randomUUID(),fixture.company,ids.manager])).rejects.toMatchObject({code:'42501'})
  await expect(scoped(ids.owner,client=>client.query('UPDATE decision_inbox SET recipient_id=$1',[ids.foreign]))).rejects.toMatchObject({code:'42501'})
  expect((await scoped(ids.foreign,notificationInbox)).length).toBe(0)
})

test('all eligible HR receive attribution, the first real decision wins and peers see it processed',async({playwright})=>{
  const owner=randomUUID(),peers=[randomUUID(),randomUUID()],inactive=randomUUID(),foreignHr=randomUUID()
  for(const [id,company,role,active] of [[owner,fixture.company,'employee',true],...peers.map(id=>[id,fixture.company,'hr_admin',true]),[inactive,fixture.company,'hr_admin',false],[foreignHr,foreignCompany,'hr_admin',true]])
    await fixture.admin.query('INSERT INTO users(id,company_id,name,email,password_hash,role,is_active) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,company,role,`${id}@example.test`,await bcrypt.hash(password,4),role,active])
  const expense=(await fixture.admin.query("INSERT INTO expense_notes(user_id,amount,expense_date,description,receipt_key) VALUES($1,12,'2026-10-23','HR fanout','fixture') RETURNING id",[owner])).rows[0].id
  await fixture.runWorker();await fixture.runWorker()
  const recipients=(await fixture.admin.query('SELECT recipient_id FROM assignment_inbox WHERE expense_id=$1 ORDER BY recipient_id',[expense])).rows.map(row=>row.recipient_id)
  expect(recipients).toEqual([fixture.hr,...peers].sort())
  const clients:APIRequestContext[]=[]
  try{
    for(const id of peers){
      const client=await playwright.request.newContext({baseURL:fixture.baseURL});clients.push(client)
      const csrf=await(await client.get('/api/auth/csrf')).json()
      await client.post('/api/auth/callback/credentials',{form:{csrfToken:csrf.csrfToken,email:`${id}@example.test`,password,callbackUrl:`${fixture.baseURL}/expenses`},maxRedirects:0})
      expect((await(await client.get('/api/auth/session')).json()).user.id).toBe(id)
    }
    const responses=await Promise.all([clients[0].post(`/api/hr/expense-notes/${expense}/approve`),clients[1].post(`/api/hr/expense-notes/${expense}/reject`)])
    expect(responses.map(response=>response.status()).sort()).toEqual([200,409])
    const status=responses[0].status()===200?'approved':'rejected'
    expect((await fixture.admin.query('SELECT status FROM expense_notes WHERE id=$1',[expense])).rows).toEqual([{status}])
    expect((await fixture.admin.query('SELECT to_status FROM expense_decision_history WHERE expense_note_id=$1',[expense])).rows).toEqual([{to_status:status}])
    expect((await fixture.admin.query('SELECT decision FROM decision_notification_outbox WHERE expense_id=$1',[expense])).rows).toEqual([{decision:status}])
    for(const id of [fixture.hr,...peers])expect((await scoped(id,notificationInbox)).find(item=>item.expenseId===expense)).toMatchObject({expenseStatus:status})
    // An HR author's own note goes to the other HR, never to its author.
    const own=(await fixture.admin.query("INSERT INTO expense_notes(user_id,amount,expense_date,description,receipt_key) VALUES($1,12,'2026-10-23','No self validation','fixture') RETURNING id",[peers[0]])).rows[0].id
    await fixture.runWorker()
    expect((await fixture.admin.query('SELECT recipient_id FROM assignment_inbox WHERE expense_id=$1 ORDER BY recipient_id',[own])).rows.map(row=>row.recipient_id)).toEqual([fixture.hr,peers[1]].sort())
    expect((await clients[0].post(`/api/hr/expense-notes/${own}/approve`)).status()).toBe(404)
    expect((await fixture.admin.query('SELECT status FROM expense_notes WHERE id=$1',[own])).rows).toEqual([{status:'pending'}])
    expect((await fixture.admin.query('SELECT id FROM expense_decision_history WHERE expense_note_id=$1',[own])).rows).toHaveLength(0)
  }finally{await Promise.all(clients.map(client=>client.dispose()))}
})

test('no eligible HR keeps the note pending with an owner-visible explanation',async({playwright})=>{
  const company=randomUUID(),owner=randomUUID()
  await fixture.admin.query("INSERT INTO companies(id,name,email_domain) VALUES($1,'No eligible HR',$2)",[company,`${company}.test`])
  await fixture.admin.query("INSERT INTO users(id,company_id,name,email,password_hash,role) VALUES($1,$2,'Lone HR',$3,$4,'hr_admin')",[owner,company,`${owner}@example.test`,await bcrypt.hash(password,4)])
  const expense=(await fixture.admin.query("INSERT INTO expense_notes(user_id,amount,expense_date,description,receipt_key) VALUES($1,12,'2026-10-23','Pending explanation','fixture') RETURNING id",[owner])).rows[0].id
  await scanAssignments(fixture.worker)
  expect((await fixture.admin.query('SELECT state,reason FROM expense_notification_routes WHERE expense_id=$1',[expense])).rows).toEqual([{state:'routing_pending',reason:'no_active_validator'}])
  expect((await fixture.admin.query('SELECT event_id FROM assignment_notification_outbox WHERE expense_id=$1',[expense])).rows).toHaveLength(0)
  const client=await playwright.request.newContext({baseURL:fixture.baseURL})
  try{
    const csrf=await(await client.get('/api/auth/csrf')).json()
    await client.post('/api/auth/callback/credentials',{form:{csrfToken:csrf.csrfToken,email:`${owner}@example.test`,password,callbackUrl:`${fixture.baseURL}/expenses`},maxRedirects:0})
    const response=await client.get(`/api/expense-notes/${expense}/validation-status`)
    expect(response.status()).toBe(200)
    expect(await response.json()).toMatchObject({status:'pending',validation:{kind:'none',message:'Aucun autre RH actif ne peut valider cette note. Elle reste en attente.'}})
  }finally{await client.dispose()}
})

test('limited concurrent workers skip a real reservation and recover an uncommitted lost session',async()=>{
  const expense=await note()
  expect((await contexts[1].post(`/api/manager/expense-notes/${expense}/approve`)).status()).toBe(200)
  const event=(await fixture.admin.query('SELECT event_id FROM decision_notification_outbox WHERE expense_id=$1',[expense])).rows[0].event_id
  let reserved!:()=>void,resume!:()=>void
  const barrier=new Promise<void>(resolve=>{reserved=resolve})
  const release=new Promise<void>(resolve=>{resume=resolve})
  const held={connect:async()=>{
    const client=await fixture.worker.connect()
    return{query:async(sql:string,values?:unknown[])=>{
      const result=await client.query(sql,values)
      if(sql.includes('FOR UPDATE SKIP LOCKED')&&result.rows[0]){reserved();await release}
      return result
    },release:(destroy?:boolean)=>client.release(destroy)} as unknown as PoolClient
  }} as Pick<Pool,'connect'>
  const first=deliverOneDecisionNotification(held,policy)
  try{
    await Promise.race([barrier,first.then(()=>{throw Error('Worker ended before reservation.')})])
    expect((await deliverOneDecisionNotification(fixture.worker,policy)).outcome).toBe('idle')
    resume();expect((await first).outcome).toBe('delivered')
    expect((await fixture.admin.query('SELECT event_id FROM decision_inbox WHERE event_id=$1',[event])).rows).toHaveLength(1)
  }finally{resume();await first.catch(()=>{})}

  const next=await note()
  expect((await contexts[1].post(`/api/manager/expense-notes/${next}/reject`)).status()).toBe(200)
  const nextEvent=(await fixture.admin.query('SELECT event_id FROM decision_notification_outbox WHERE expense_id=$1',[next])).rows[0].event_id
  const lost=await fixture.worker.connect()
  const pid=(await lost.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
  try{
    await lost.query('BEGIN')
    await lost.query('SELECT event_id FROM decision_notification_outbox WHERE event_id=$1 FOR UPDATE',[nextEvent])
    await new PostgresInAppNotificationAdapter(lost).notifyDecision(ids.owner,next,'rejected',{eventId:nextEvent})
  }finally{lost.release(true)}
  await expect.poll(async()=>Number((await fixture.admin.query('SELECT count(*) FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0].count)).toBe(0)
  expect((await fixture.admin.query('SELECT event_id FROM decision_inbox WHERE event_id=$1',[nextEvent])).rows).toHaveLength(0)
  await fixture.runWorker();await fixture.runWorker()
  expect((await fixture.admin.query('SELECT event_id FROM decision_inbox WHERE event_id=$1',[nextEvent])).rows).toHaveLength(1)
})

test('actual decision routes roll back decision and history when the transactional intent cannot be stored',async()=>{
  const expense=await note(),trigger=`ha09_abort_${randomUUID().replaceAll('-','')}`
  try{
    await fixture.admin.query(`CREATE FUNCTION public.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $body$ BEGIN RAISE EXCEPTION 'controlled intent failure'; END $body$`)
    await fixture.admin.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON public.decision_notification_outbox FOR EACH ROW WHEN (NEW.expense_id='${expense}'::uuid) EXECUTE FUNCTION public.${trigger}()`)
    const response=await contexts[1].post(`/api/manager/expense-notes/${expense}/approve`)
    expect(response.status()).toBe(500)
    expect(await response.text()).not.toContain('controlled intent failure')
    expect((await fixture.admin.query('SELECT status FROM expense_notes WHERE id=$1',[expense])).rows).toEqual([{status:'pending'}])
    expect((await fixture.admin.query('SELECT id FROM expense_decision_history WHERE expense_note_id=$1',[expense])).rows).toHaveLength(0)
    expect((await fixture.admin.query('SELECT event_id FROM decision_notification_outbox WHERE expense_id=$1',[expense])).rows).toHaveLength(0)
  }finally{await fixture.admin.query(`DROP TRIGGER IF EXISTS ${trigger} ON decision_notification_outbox;DROP FUNCTION IF EXISTS public.${trigger}()`)}
  expect((await contexts[1].post(`/api/manager/expense-notes/${expense}/approve`)).status()).toBe(200)
  await fixture.runWorker()
  expect((await fixture.admin.query('SELECT event_id FROM decision_inbox WHERE expense_id=$1',[expense])).rows).toHaveLength(1)
})
