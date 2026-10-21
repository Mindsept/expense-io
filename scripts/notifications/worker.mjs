import { Pool } from 'pg'
import { setTimeout as delay } from 'node:timers/promises'

let pool
try {
  if((process.argv[2]==='--requeue'?process.argv.length!==6:process.argv.length!==3) || !['--once','--serve','--failed','--routing','--requeue'].includes(process.argv[2]) || !process.env.NOTIFICATION_WORKER_DATABASE_URL)throw Error('Explicit worker mode/connection required.')
  if(Object.keys(process.env).some(key=>/(ADMIN|BOOTSTRAP|MIGRATION).*DATABASE_URL/.test(key)&&process.env[key]))throw Error('Administrator credentials must stay outside the worker process.')
  const {assertNotificationWorker,deliverOneDecisionNotification,deliverOneAssignment,scanAssignments}=await import(new URL('../../src/lib/notifications/inbox.ts',import.meta.url).href)
  pool=new Pool({connectionString:process.env.NOTIFICATION_WORKER_DATABASE_URL,max:1,connectionTimeoutMillis:5000,options:'-c search_path=pg_catalog,public,pg_temp'})
  await assertNotificationWorker(pool)
  if(process.argv[2]==='--failed'){
    const result=await pool.query("SELECT event_id,company_id,expense_id,attempts,last_failure_code,'decision' AS kind FROM public.decision_notification_outbox WHERE state='failed' UNION ALL SELECT event_id,company_id,expense_id,attempts,last_failure_code,'assignment' FROM public.assignment_notification_outbox WHERE state='failed' LIMIT 100")
    console.log(JSON.stringify(result.rows))
  }else if(process.argv[2]==='--routing'){
    console.log(JSON.stringify((await pool.query("SELECT expense_id,company_id,reason,checked_at FROM public.expense_notification_routes WHERE state='routing_pending' ORDER BY checked_at LIMIT 100")).rows))
  }else if(process.argv[2]==='--requeue'){
    const [kind,eventId,companyId]=process.argv.slice(3),uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
    if(!['decision','assignment'].includes(kind)||!uuid.test(eventId)||!uuid.test(companyId))throw Error('Explicit kind/event/company required.')
    const table=kind==='decision'?'decision_notification_outbox':'assignment_notification_outbox'
    const changed=(await pool.query(`UPDATE public.${table} SET state='pending',attempts=0,next_attempt_at=clock_timestamp(),last_failure_code=NULL WHERE event_id=$1 AND company_id=$2 AND state='failed'`,[eventId,companyId])).rowCount
    console.log(JSON.stringify({requeued:changed}))
  }else{
    const routing=process.env.NOTIFICATION_HR_RECIPIENTS?JSON.parse(process.env.NOTIFICATION_HR_RECIPIENTS):{}
    if(!routing||typeof routing!=='object'||Array.isArray(routing))throw Error('Invalid explicit HR routing.')
    let stop=false
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stop=true})
    do{
      const scan=await scanAssignments(pool,routing,25)
      const totals={...scan,delivered:0,retry:0,failed:0,obsolete:0}
      for(let i=0;i<25&&!stop;i++){
        const decision=await deliverOneDecisionNotification(pool,{maxAttempts:5,retryDelaySeconds:60})
        const assignment=await deliverOneAssignment(pool,{maxAttempts:5,retryDelaySeconds:60})
        if(decision.outcome==='idle'&&assignment.outcome==='idle')break
        if(decision.outcome!=='idle')totals[decision.outcome]++
        if(assignment.outcome!=='idle')totals[assignment.outcome]++
      }
      console.log(JSON.stringify(totals))
      if(process.argv[2]==='--once')break
      if(!stop)await delay(1000)
    }while(!stop)
  }
}catch{console.error('Notification worker unavailable. Check its isolated runtime configuration; no raw database cause is logged.');process.exitCode=1}
finally{await pool?.end()}
