import { randomUUID, randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Pool } from 'pg'
import { runner } from 'node-pg-migrate'
import { S3Client, HeadBucketCommand, DeleteBucketCommand, DeleteObjectCommand, HeadObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { expect, test } from '@playwright/test'
import { readTestTarget } from '../../../support/test-target'
import { demoSettings, demoNote } from '../../../../scripts/mathis/MATH-03/settings.mjs'
import { ensureDemoBucket, DEMO_PNG } from '../../../../scripts/mathis/MATH-03/storage.mjs'
import { runDemoSeed } from '../../../../scripts/mathis/MATH-03/seed'

readTestTarget()
const baseURL=process.env.DATABASE_URL
if(!baseURL)throw Error('MATH-03 requires the common isolated administrator URL.')
const cluster=new Pool({connectionString:baseURL,max:1}),name=`math03_${randomUUID().replaceAll('-','')}_test`
const url=new URL(baseURL);url.pathname='/'+name
const pool=new Pool({connectionString:url.href,max:4,connectionTimeoutMillis:3000,statement_timeout:5000})
const bucket='receipts-demo-test',s3=new S3Client({endpoint:process.env.S3_ENDPOINT,region:'us-east-1',forcePathStyle:true,maxAttempts:1,credentials:{accessKeyId:'test',secretAccessKey:'test'}})
let created=false,bucketOwned=false,puts=0
s3.middlewareStack.add((next,context)=>async args=>{if(context.commandName==='PutObjectCommand')puts++;return next(args)},{step:'initialize',name:'math03CountRealPuts'})
const settings=()=>{
 const domain=`${randomUUID()}.test`
 return demoSettings({SEED_DEMO_ENV:'local-test',SEED_CONFIRM_DATABASE:name,SEED_ADMIN_DATABASE_URL:url.href,S3_ENDPOINT:process.env.S3_ENDPOINT,S3_BUCKET:bucket,S3_ACCESS_KEY_ID:'test',S3_SECRET_ACCESS_KEY:'test',
  ...Object.fromEntries(['HR','MANAGER','EMPLOYEE'].flatMap(key=>[[`SEED_${key}_EMAIL`,`${key.toLowerCase()}@${domain}`],[`SEED_${key}_PASSWORD`,randomBytes(24).toString('base64url')]]))})
}
async function counts(config:ReturnType<typeof settings>){
 const users=await pool.query('SELECT id FROM users WHERE company_id=(SELECT id FROM companies WHERE email_domain=$1)',[config.domain])
 const notes=await pool.query('SELECT id,receipt_key FROM expense_notes WHERE user_id=ANY($1::uuid[]) ORDER BY id',[users.rows.map(x=>x.id)])
 return {users:users.rowCount,notes:notes.rows}
}
async function employee(config:ReturnType<typeof settings>){return (await pool.query('SELECT * FROM users WHERE email=$1',[config.roles.find(x=>x.key==='EMPLOYEE')!.email])).rows[0]}
async function broken(config:ReturnType<typeof settings>){
 await runDemoSeed(config,{pool,s3});const actor=await employee(config),expected=demoNote(actor.id,'EMPLOYEE')
 await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:expected.key}));await pool.query("UPDATE expense_notes SET receipt_key='' WHERE id=$1",[expected.id]);return expected
}

test.beforeAll(async()=>{
 await cluster.query(`CREATE DATABASE ${name}`);created=true
 const quiet=()=>{}
 await runner({databaseUrl:url.href,dir:'migrations',migrationsTable:'pgmigrations',direction:'up',checkOrder:true,singleTransaction:true,logger:{debug:quiet,info:quiet,warn:quiet,error:quiet}})
 try{await s3.send(new HeadBucketCommand({Bucket:bucket}));throw Error('MATH-03 test bucket already exists; refuse adopting it.')}
 catch(error){if((error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==404)throw error}
})
test.afterAll(async()=>{
 try{
  if(created&&bucketOwned){
   const users=(await pool.query('SELECT id FROM users')).rows
   const known=new Set(users.flatMap(x=>['EMPLOYEE','MANAGER'].map(kind=>demoNote(x.id,kind).key)))
   const listed=await s3.send(new ListObjectsV2Command({Bucket:bucket}))
   if(listed.IsTruncated || (listed.Contents??[]).some(x=>!known.has(x.Key!)))throw Error('Unexpected objects retained; no bucket-wide deletion.')
   for(const object of listed.Contents??[])await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:object.Key!}))
   await s3.send(new DeleteBucketCommand({Bucket:bucket}))
  }
 }finally{await pool.end();s3.destroy();try{if(created)await cluster.query(`DROP DATABASE ${name}`)}finally{await cluster.end()}}
})

test('missing bucket fails before data creation; explicit ensure-bucket creates and rechecks it',async()=>{
 const config=settings()
 await expect(runDemoSeed(config,{pool,s3})).rejects.toThrow('bucket_missing')
 expect((await pool.query('SELECT count(*)::int AS count FROM companies')).rows[0].count).toBe(0)
 await expect(ensureDemoBucket(config,s3)).resolves.toEqual({bucket:'ready'});bucketOwned=true
 await expect(ensureDemoBucket(config,s3)).resolves.toEqual({bucket:'existing'})
})
test('two runs preserve role, company, password hash, name and a changed manager without duplicates or uploads',async()=>{
 const config=settings();await runDemoSeed(config,{pool,s3});const actor=await employee(config)
 await pool.query("UPDATE users SET manager_id=NULL,name='Changed name',role='manager',password_hash='preserve-this-private-fixture-hash' WHERE id=$1",[actor.id])
 const before=await employee(config),putCount=puts
 const report=await runDemoSeed(config,{pool,s3})
 expect(await employee(config)).toEqual(before)
 expect(report).toMatchObject({usersCreated:0,usersPreserved:3,notesCreated:0,notesPreserved:2,receiptsUploaded:0})
 expect(puts).toBe(putCount);expect(await counts(config)).toMatchObject({users:3,notes:[expect.anything(),expect.anything()]})
})
test('real PostgreSQL/S3 recovery after an injected stop before upload repairs the existing note without duplication',async()=>{
 const config=settings(),expected=await broken(config)
 await expect(runDemoSeed(config,{pool,s3,mode:'repair',checkpoint:async stage=>{if(stage==='before-upload')throw Error('Synthetic interruption before upload')}})).rejects.toThrow('Synthetic interruption')
 expect((await pool.query('SELECT receipt_key FROM expense_notes WHERE id=$1',[expected.id])).rows[0].receipt_key).toBe('')
 await runDemoSeed(config,{pool,s3,mode:'repair'})
 const object=await s3.send(new GetObjectCommand({Bucket:bucket,Key:expected.key}));expect(Buffer.from(await object.Body!.transformToByteArray())).toEqual(DEMO_PNG)
 expect((await counts(config)).notes).toHaveLength(2)
})
test('real PostgreSQL/S3 recovery after upload but before key persistence reuses the healthy object',async()=>{
 const config=settings(),expected=await broken(config)
 await expect(runDemoSeed(config,{pool,s3,mode:'repair',checkpoint:async stage=>{if(stage==='after-upload')throw Error('Synthetic interruption after upload')}})).rejects.toThrow('Synthetic interruption')
 expect((await pool.query('SELECT receipt_key FROM expense_notes WHERE id=$1',[expected.id])).rows[0].receipt_key).toBe('')
 await s3.send(new HeadObjectCommand({Bucket:bucket,Key:expected.key}));const before=puts
 const report=await runDemoSeed(config,{pool,s3,mode:'repair'})
 expect(puts).toBe(before);expect(report).toMatchObject({receiptsUploaded:0,receiptsRepaired:1})
 expect((await counts(config)).notes).toHaveLength(2)
})
test('an incomplete existing note requires explicit repair, not another initialization',async()=>{
 const config=settings();await broken(config)
 await expect(runDemoSeed(config,{pool,s3})).rejects.toThrow('receipt_incomplete_run_seed_repair')
 expect((await counts(config)).notes).toHaveLength(2)
})
test('ambiguous marked notes fail before any receipt mutation',async()=>{
 const config=settings();await runDemoSeed(config,{pool,s3});const actor=await employee(config),expected=demoNote(actor.id,'EMPLOYEE')
 await pool.query("INSERT INTO expense_notes(user_id,amount,expense_date,description,receipt_key) VALUES($1,42.50,CURRENT_DATE,$2,'')",[actor.id,expected.description])
 const before=await counts(config),putCount=puts
 await expect(runDemoSeed(config,{pool,s3,mode:'repair'})).rejects.toThrow('ambiguous_demo_notes')
 expect(await counts(config)).toEqual(before);expect(puts).toBe(putCount)
})
test('a configured identity in a foreign company is never moved and repair performs no writes',async()=>{
 const config=settings();await runDemoSeed(config,{pool,s3});const actor=await employee(config)
 const other=(await pool.query('INSERT INTO companies(name,email_domain) VALUES($1,$2) RETURNING id',['Synthetic foreign',`${randomUUID()}.test`])).rows[0]
 await pool.query('UPDATE users SET company_id=$1 WHERE id=$2',[other.id,actor.id])
 const before=await employee(config),putCount=puts
 await expect(runDemoSeed(config,{pool,s3,mode:'repair'})).rejects.toThrow('foreign_demo_identity')
 expect(await employee(config)).toEqual(before);expect(puts).toBe(putCount)
})
test('an ordinary note with a similar description is left intact',async()=>{
 const config=settings();await runDemoSeed(config,{pool,s3});const actor=await employee(config)
 const ordinary=(await pool.query("INSERT INTO expense_notes(user_id,amount,expense_date,description,receipt_key) VALUES($1,99,CURRENT_DATE,'Taxi aéroport','ordinary/receipt.png') RETURNING *",[actor.id])).rows[0]
 await runDemoSeed(config,{pool,s3,mode:'repair'})
 expect((await pool.query('SELECT * FROM expense_notes WHERE id=$1',[ordinary.id])).rows[0]).toEqual(ordinary)
})
test('unmarked legacy seed notes require review instead of automatic adoption or duplication',async()=>{
 const config=settings();await runDemoSeed(config,{pool,s3});const actor=await employee(config),expected=demoNote(actor.id,'EMPLOYEE')
 await pool.query('UPDATE expense_notes SET description=$1 WHERE id=$2',[expected.legacyDescription,expected.id])
 const before=await counts(config)
 await expect(runDemoSeed(config,{pool,s3})).rejects.toThrow('legacy_demo_requires_review')
 expect(await counts(config)).toEqual(before)
})
test('an uncertain post-commit result retains its receipt and the next initialization does not duplicate it',async()=>{
 const config=settings()
 await expect(runDemoSeed(config,{pool,s3,checkpoint:async(stage,kind)=>{if(stage==='after-persist'&&kind==='EMPLOYEE')throw Error('Synthetic lost acknowledgement')}})).rejects.toThrow('Synthetic lost acknowledgement')
 const report=await runDemoSeed(config,{pool,s3})
 expect(report.notesCreated).toBe(1);expect((await counts(config)).notes).toHaveLength(2)
})
test('the actual CLI refuses a development target and does not print secrets',async()=>{
 const exec=promisify(execFile),password=randomBytes(24).toString('base64url')
 const result=await exec(process.execPath,['scripts/seed.mjs'],{encoding:'utf8',env:{NODE_ENV:'test',PATH:process.env.PATH,SEED_DEMO_ENV:'local-test',SEED_CONFIRM_DATABASE:'expense_io',SEED_ADMIN_DATABASE_URL:`postgres://expense:${password}@127.0.0.1:5433/expense_io`,S3_ENDPOINT:process.env.S3_ENDPOINT},timeout:10000}).then(x=>({...x,code:0}),error=>({stdout:error.stdout as string,stderr:error.stderr as string,code:error.code as number}))
 expect(result.code).toBe(1);expect(result.stderr).toContain('non_demo_database');expect(result.stdout+result.stderr).not.toContain(password);expect(result.stdout+result.stderr).not.toContain('postgres://')
})
