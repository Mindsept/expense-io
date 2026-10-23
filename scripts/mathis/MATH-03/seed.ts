import bcrypt from 'bcryptjs'
import type { Pool } from 'pg'
import type { S3Client } from '@aws-sdk/client-s3'
import { SubmitExpense } from '@/application/submit-expense'
import { ExpensePersistenceFailure } from '@/ports/ExpenseSubmissionPort'
import { DemoSeedError, demoNote, selectDemoNote, assertDemoSettings } from './settings.mjs'
import { DEMO_PNG, healthyDemoObject, putDemoObject, removeDemoObject, checkDemoBucket } from './storage.mjs'
import type { demoSettings } from './settings.mjs'

type Settings=ReturnType<typeof demoSettings>
type Actor={id:string;company_id:string;role:string;name:string;manager_id:string|null;is_active:boolean}
type Note={id:string;user_id:string;description:string;receipt_key:string}
type Checkpoint=(stage:'before-upload'|'after-upload'|'after-persist',kind:string)=>Promise<void>

export async function runDemoSeed(settings:Settings, options:{pool:Pool;s3:S3Client;mode?:'init'|'repair';checkpoint?:Checkpoint}) {
  assertDemoSettings(settings)
  const {pool,s3,mode='init',checkpoint=async()=>{}}=options
  if (!['init','repair'].includes(mode)) throw new DemoSeedError('unknown_operation')
  const deadline=Date.now()+60_000, client=await pool.connect()
  let locked=false
  const report={operation:mode,companiesCreated:0,usersCreated:0,usersPreserved:0,notesCreated:0,notesPreserved:0,receiptsUploaded:0,receiptsRepaired:0,cleanupNotices:[] as string[]}
  const lock=`ARLA:MATH-03:${settings.databaseName}:${settings.domain}`
  async function actorStillValid(actor:Actor) {
    const row=(await client.query<Actor>('SELECT id,company_id,role,name,manager_id,is_active FROM users WHERE id=$1',[actor.id])).rows[0]
    if(!row || row.company_id!==actor.company_id || !row.is_active) throw new DemoSeedError('demo_actor_changed')
  }
  async function transaction<T>(work:()=>Promise<T>):Promise<T> {
    await client.query('BEGIN')
    try { const result=await work();await client.query('COMMIT');return result }
    catch(error) { try{await client.query('ROLLBACK')}catch{};throw error }
  }
  try {
    const identity=(await client.query(`SELECT current_database() AS database,current_user AS current_role,session_user AS login,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`)).rows[0]
    if(identity.database!==settings.databaseName || identity.current_role!==identity.login || !(identity.rolsuper||identity.rolbypassrls) || identity.current_role==='expense_web') throw new DemoSeedError('separate_maintenance_login_required')
    await checkDemoBucket(settings,s3,deadline)
    locked=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',[lock])).rows[0].acquired
    if(!locked) throw new DemoSeedError('demo_preparation_busy')
    const actors:Record<string,Actor>={}
    await transaction(async()=>{
      let company=(await client.query('SELECT id FROM companies WHERE email_domain=$1',[settings.domain])).rows[0]
      // Validate every existing identity before creating any missing one.
      for(const role of settings.roles) {
        const row=(await client.query<Actor>('SELECT id,company_id,role,name,manager_id,is_active FROM users WHERE email=$1 FOR SHARE',[role.email])).rows[0]
        if(row && (!company || row.company_id!==company.id)) throw new DemoSeedError('foreign_demo_identity')
        if(row) {actors[role.key]=row;report.usersPreserved++}
        else if(mode==='repair') throw new DemoSeedError('initialisation_required')
        else if(!role.password || role.password.length<12) throw new DemoSeedError('private_initial_password_required')
      }
      if(!company) {
        if(mode==='repair') throw new DemoSeedError('initialisation_required')
        company=(await client.query('INSERT INTO companies(name,email_domain) VALUES($1,$2) RETURNING id',['ARLA synthetic demonstration',settings.domain])).rows[0];report.companiesCreated++
      }
      for(const role of settings.roles) if(!actors[role.key]) {
        const hash=await bcrypt.hash(role.password!,12)
        const row=(await client.query<Actor>(`INSERT INTO users(email,name,password_hash,role,company_id,manager_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,company_id,role,name,manager_id,is_active`,[role.email,role.name,hash,role.role,company.id,role.key==='EMPLOYEE'?actors.MANAGER.id:null])).rows[0]
        actors[role.key]=row;report.usersCreated++
      }
    })
    const plans:Array<{kind:string;actor:Actor;expected:ReturnType<typeof demoNote>;existing:Note|undefined}>=[]
    // Reject all ambiguous/unmarked legacy candidates before touching any receipt.
    for(const kind of ['EMPLOYEE','MANAGER']) {
      const actor=actors[kind],expected=demoNote(actor.id,kind)
      const rows=(await client.query<Note>('SELECT id,user_id,description,receipt_key FROM expense_notes WHERE id=$3 OR (user_id=$1 AND description=$2)',[actor.id,expected.description,expected.id])).rows
      if(rows.some(row=>row.description===expected.legacyDescription)) throw new DemoSeedError('legacy_demo_requires_review')
      const existing=selectDemoNote(rows,actor.id,expected) as Note|undefined
      if(!existing && (await client.query('SELECT 1 FROM expense_notes WHERE user_id=$1 AND description=$2 LIMIT 1',[actor.id,expected.legacyDescription])).rowCount) throw new DemoSeedError('legacy_demo_requires_review')
      if(!existing && mode==='repair') throw new DemoSeedError('initialisation_required')
      plans.push({kind,actor,expected,existing})
    }
    for(const {kind,actor,expected,existing} of plans) {
      if(Date.now()>=deadline) throw new DemoSeedError('operation_deadline')
      await actorStillValid(actor)
      const healthy=await healthyDemoObject(settings,s3,expected.key,deadline)
      if(existing) {
        if(existing.receipt_key===expected.key && healthy) {report.notesPreserved++;continue}
        if(mode!=='repair') throw new DemoSeedError('receipt_incomplete_run_seed_repair')
        if(!healthy) {await checkpoint('before-upload',kind);await putDemoObject(settings,s3,expected.key,deadline);report.receiptsUploaded++;await checkpoint('after-upload',kind)}
        await transaction(async()=>{
          await actorStillValid(actor)
          const updated=await client.query(`UPDATE expense_notes SET receipt_key=$1 WHERE id=$2 AND user_id=$3 AND description=$4 AND receipt_key=$5 RETURNING id`,[expected.key,expected.id,actor.id,expected.description,existing.receipt_key])
          if(updated.rowCount!==1) throw new DemoSeedError('demo_note_changed')
        })
        report.receiptsRepaired++;report.notesPreserved++;await checkpoint('after-persist',kind)
        continue
      }
      // Reuse LE-02's upload-first contract and its known/uncertain commit handling.
      const submission=new SubmitExpense<Note>({
        checkCurrentActor:()=>actorStillValid(actor),
        createComplete:async input=>{
          let committing=false
          try {
            await client.query('BEGIN');await actorStillValid(actor)
            const row=(await client.query<Note>(`INSERT INTO expense_notes(id,user_id,amount,expense_date,description,receipt_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,user_id,description,receipt_key`,[expected.id,actor.id,input.amount,input.expenseDate,input.description,input.receiptKey])).rows[0]
            committing=true;await client.query('COMMIT');await checkpoint('after-persist',kind);return row
          } catch(error) {try{await client.query('ROLLBACK')}catch{};throw new ExpensePersistenceFailure(error,committing?'unknown':'not_committed')}
        },
      },{
        upload:async key=>{if(!healthy){await checkpoint('before-upload',kind);await putDemoObject(settings,s3,key,deadline);report.receiptsUploaded++;await checkpoint('after-upload',kind)}},
        remove:async key=>{
          // Never delete a referenced receipt, including an acknowledged-late commit.
          if((await client.query('SELECT 1 FROM expense_notes WHERE receipt_key=$1 LIMIT 1',[key])).rowCount) return
          await removeDemoObject(settings,s3,key,deadline)
        },
        getSignedUrl:async()=>{throw new DemoSeedError('signed_urls_not_emitted_by_seed')},
      },()=>expected.id,notice=>{report.cleanupNotices.push(notice.code)})
      await submission.execute({amount:expected.amount,expenseDate:new Date().toISOString().slice(0,10),description:expected.description,buffer:DEMO_PNG,mimeType:'image/png',extension:'.png'})
      report.notesCreated++
    }
    return report
  } finally {
    try {if(locked)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[lock])}
    finally {client.release()}
  }
}
