import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { Pool } from 'pg'
import { runtimeFixture } from '../HA-04/runtime-fixture'
import { provisionRuntime } from '../../../../scripts/rls/provision-runtime.mjs'
import { assertNotificationWorker } from '../../../../src/lib/notifications/inbox'
const execute=promisify(execFile)
export async function notificationFixture(port=3143){
  const fixture=await runtimeFixture(port)
  const password=randomBytes(32).toString('base64url')
  await provisionRuntime(fixture.admin,password,'expense_notifications')
  const url=new URL(fixture.adminURL);url.username='expense_notifications';url.password=password
  const worker=new Pool({connectionString:url.href,max:5,options:'-c search_path=pg_catalog,public,pg_temp'})
  try{await assertNotificationWorker(worker)}catch(error){await worker.end();await fixture.close();throw error}
  async function runWorker(args=['--once'],routing:Record<string,string>={}){
    const env={...process.env}
    for(const key of Object.keys(env))if(/DATABASE_URL|POSTGRES_|SEED_|AUTH_SECRET|ENROLLMENT_DELIVERY_BEARER/.test(key))delete env[key]
    env.NOTIFICATION_WORKER_DATABASE_URL=url.href
    env.NOTIFICATION_HR_RECIPIENTS=JSON.stringify(routing)
    const output=await execute(process.execPath,[resolve('scripts/notifications/worker.mjs'),...args],{env,timeout:30_000,maxBuffer:64*1024})
    return JSON.parse(output.stdout.trim())
  }
  return{...fixture,worker,runWorker,close:async()=>{await worker.end();await fixture.close()}}
}
