import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { registerHooks } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'
import { request } from '@playwright/test'
import { createWorker } from 'tesseract.js'
import { preflight } from '../tests/support/preflight.mjs'
import { prepare as prepareMain } from '../tests/support/prepare.mjs'
import { summarize } from './mathis/MATH-05/metrics.mjs'
import { benchmarkWebEnvironment } from './mathis/MATH-05/runtime.mjs'
import { provisionRuntime } from './rls/provision-runtime.mjs'
import { assertRuntimeDatabase } from '../src/lib/runtime-database.ts'
import { expenseValidatorSql } from '../src/lib/expense-access.ts'

const root=process.cwd(), action=process.argv[2], volume=Number(process.argv[3])
const runtime=path.join(root,'.ci-output/benchmark'), privateDir=path.join(runtime,'private'), marker=path.join(privateDir,'benchmark.json'), state=path.join(runtime,'active.json')
const protocol='math05-v3-limited-runtime-20261023', passes=3, concurrency=4, requestsPerPass=30
let config, pool, runtimePool, server, serverOutput='', expired=false, failed=false
const contexts=[], observations=[], sqlPlans=[], ocr=[]
const json=(file,data)=>writeFileSync(file,JSON.stringify(data,null,2)+'\n',{mode:0o600})
function command(args) {
  if(!process.env.npm_execpath)throw Error('Use the documented npm scripts.')
  const r=spawnSync(process.execPath,[process.env.npm_execpath,...args],{cwd:root,env:benchmarkWebEnvironment(config),encoding:'utf8',timeout:240000,maxBuffer:8*1024*1024})
  if(r.status!==0)throw Error(`Preparation command failed: ${args.join(' ')}. Inspect the owned test reports.`)
}
function redactTestOutput(text, target=config) {
  let safe=String(text)
  const values=Object.entries(target?.env??{}).filter(([key])=>/PASSWORD|AUTH_SECRET|DATABASE_URL/.test(key)).map(([,value])=>value).concat(target?.fixturePassword??[], target?.runtimePassword??[]).filter(Boolean).sort((a,b)=>b.length-a.length)
  for(const value of values)safe=safe.split(value).join('[REDACTED]')
  return safe.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi,'[DATABASE_URL_REDACTED]').replace(/(?:authjs|next-auth)\.(?:session-token|csrf-token)=[^;\s]+/gi,'[AUTH_COOKIE_REDACTED]')
}
function assertLocalDockerEndpoint(endpoint){if(typeof endpoint!=='string'||!endpoint.trim().startsWith('unix:///'))throw Error('Benchmark requires a local Unix Docker socket.')}
function check(target) {
  preflight(target.env)
  if(target.project!==target.env.ARLA_TEST_PROJECT||target.databaseURL!==target.env.DATABASE_URL||target.baseURL!==target.env.ARLA_TEST_BASE_URL||target.database!=='expense_io_test'||target.id!==target.project.slice('arla-ci-bench-'.length)||!/^[a-f0-9]{12}$/.test(target.id))throw Error('Benchmark metadata differs from guarded configuration.')
  if(process.version!==`v${readFileSync('.nvmrc','utf8').trim()}` || !process.env.npm_config_user_agent?.startsWith('npm/11.19.1 '))throw Error('Use the pinned Node/npm pair.')
  benchmarkWebEnvironment(target)
  for(const key of ['ARLA_TEST_ENV','ARLA_TEST_BASE_URL','DATABASE_URL','S3_ENDPOINT','S3_BUCKET'])if(process.env[key]&&process.env[key]!==target.env[key])throw Error('Conflicting external test target refused before writes.')
}
function docker(args) {
  const r=spawnSync('docker',args,{env:{...process.env,...config.env},encoding:'utf8',timeout:180000,maxBuffer:2e6})
  if(r.status!==0)throw Error('Owned benchmark Docker operation failed; configuration is retained for bench:down.')
  return r.stdout
}
function localDocker() {
  if(process.env.DOCKER_HOST)assertLocalDockerEndpoint(process.env.DOCKER_HOST)
  assertLocalDockerEndpoint(docker(['context','inspect','--format','{{(index .Endpoints "docker").Host}}']))
}
function ownership(required=false) {
  const lines=docker(['ps','-a','--filter',`label=com.docker.compose.project=${config.project}`,'--format','{{.Label "arla.test.environment"}} {{.Label "arla.test.project"}}']).trim().split('\n').filter(Boolean)
  if(lines.length>2||lines.some(line=>line!==`isolated ${config.project}`)||(required&&lines.length!==2))throw Error('Owned benchmark service labels do not match.')
}
const compose=()=>['compose','-p',config.project,'-f','docker-compose.test.yml']
function readConfig() {
  for(const file of [runtime,state,privateDir])if(lstatSync(file).isSymbolicLink())throw Error('Symlinked benchmark target refused.')
  config=JSON.parse(readFileSync(state,'utf8'));check(config);localDocker();ownership(true)
  pool=new Pool({connectionString:config.databaseURL,max:1,connectionTimeoutMillis:3000,query_timeout:10000,statement_timeout:9000})
}
function createConfig() {
  const id=randomBytes(6).toString('hex'), secret=()=>randomBytes(32).toString('hex')
  const env={ARLA_TEST_ENV:'isolated',ARLA_TEST_PROJECT:`arla-ci-bench-${id}`,ARLA_TEST_BASE_URL:'http://127.0.0.1:3210',ARLA_TEST_DB_PORT:'55440',ARLA_TEST_S3_PORT:'45740',HA01_TEST_PORT:'3211',POSTGRES_USER:'expense_test',POSTGRES_DB:'expense_io_test',POSTGRES_PASSWORD:secret(),S3_ENDPOINT:'http://127.0.0.1:45740',S3_BUCKET:'receipts-ci-test',S3_REGION:'us-east-1',S3_ACCESS_KEY_ID:'test',S3_SECRET_ACCESS_KEY:'test',S3_FORCE_PATH_STYLE:'true',AUTH_SECRET:secret(),AUTH_TRUST_HOST:'true',AUTH_URL:'http://127.0.0.1:3210',NEXT_TELEMETRY_DISABLED:'1'}
  env.DATABASE_URL=`postgres://expense_test:${env.POSTGRES_PASSWORD}@127.0.0.1:55440/expense_io_test`
  for(const role of ['EMPLOYEE','MANAGER','HR']){env[`ARLA_TEST_${role}_EMAIL`]=env[`SEED_${role}_EMAIL`]=`${role.toLowerCase()}@expense.test`;env[`ARLA_TEST_${role}_PASSWORD`]=env[`SEED_${role}_PASSWORD`]=secret()}
  const runtimePassword=secret(), web=new URL(env.DATABASE_URL);web.username='expense_web';web.password=runtimePassword
  return {id,runtimePassword,runtimeDatabaseURL:web.href,project:env.ARLA_TEST_PROJECT,database:'expense_io_test',databaseURL:env.DATABASE_URL,baseURL:env.ARLA_TEST_BASE_URL,appPort:3210,fixturePassword:secret(),env}
}
function down(){check(config);localDocker();ownership();docker([...compose(),'down','--volumes','--remove-orphans']);rmSync(state);console.log('Only the owned benchmark stack was removed.')}
async function vacant(port){await new Promise((resolve,reject)=>{const probe=createServer();probe.once('error',()=>reject(Error('Dedicated benchmark port occupied; no listener stopped.')));probe.listen(port,'127.0.0.1',()=>probe.close(resolve))})}
async function bounded(work, onTimeout=()=>{}) {let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{Promise.resolve(onTimeout()).catch(()=>{});reject(Error('OCR operation exceeded 30 seconds.'))},30000)})])}finally{clearTimeout(timer)}}
async function identity(connection=pool, expectedRole='expense_test') {
  const {rows:[row]}=await connection.query('SELECT current_database() AS database,current_user AS role,session_user AS login,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolinherit,version() AS version FROM pg_roles WHERE rolname=current_user')
  if(row.database!==config.database||row.role!==expectedRole||row.login!==expectedRole)throw Error('Actual DB differs from guarded target.')
  return row
}
async function limitedRuntime() {
  runtimePool=new Pool({connectionString:config.runtimeDatabaseURL,max:1,connectionTimeoutMillis:3000,query_timeout:10000,statement_timeout:9000})
  await assertRuntimeDatabase(runtimePool,benchmarkWebEnvironment(config))
  const db=await identity(runtimePool,'expense_web')
  const invisible=(await runtimePool.query('SELECT count(*)::int AS count FROM expense_notes')).rows[0].count
  if(invisible!==0)throw Error('Benchmark runtime sees notes without actor context.')
  return {...db,startupIsolationCheck:'passed',notesWithoutActor:invisible}
}
async function prepare() {
  if(![1000,10000].includes(volume))throw Error('bench:prepare requires exactly 1000 or 10000 notes.')
  if(existsSync(state))throw Error('An active benchmark exists; use bench:down before preparing a new fixture.')
  config=createConfig();check(config)
  for(const directory of [path.join(root,'.ci-output'),runtime,privateDir]){if(existsSync(directory)&&lstatSync(directory).isSymbolicLink())throw Error('Symlinked runtime refused.');mkdirSync(directory,{recursive:true,mode:0o700})}
  localDocker();ownership();for(const port of [3210,3211,55440,45740])await vacant(port)
  json(state,config);docker([...compose(),'up','-d','--wait','--wait-timeout','90']);await prepareMain({...process.env,...config.env});readConfig();await identity()
  const company=randomUUID(), users={EMPLOYEE:randomUUID(),MANAGER:randomUUID(),HR:randomUUID()}
  const domain=`bench-${config.id}.example.test`, password=config.fixturePassword, hash=await bcrypt.hash(password,10)
  const client=await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('INSERT INTO companies(id,name,email_domain) VALUES($1,$2,$3)',[company,protocol,domain])
    for(const [key,role] of [['MANAGER','manager'],['EMPLOYEE','employee'],['HR','hr_admin']])await client.query('INSERT INTO users(id,company_id,name,email,password_hash,role,manager_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[users[key],company,`MATH05 ${key}`,`${key.toLowerCase()}@${domain}`,hash,role,key==='EMPLOYEE'?users.MANAGER:null])
    await client.query(`INSERT INTO expense_notes(user_id,amount,expense_date,description,receipt_key,status,created_at)
      SELECT CASE WHEN i%2=0 THEN $1::uuid ELSE $2::uuid END,
       (100+(i*7919)%99000)::numeric/100, DATE '2026-01-01'+(i%280),
       $3||':'||i, 'benchmark/no-receipt',
       CASE WHEN i%10<7 THEN 'pending' WHEN i%10<9 THEN 'approved' ELSE 'rejected' END,
       TIMESTAMPTZ '2026-01-01 12:00:00+00'+i*INTERVAL '1 minute'
      FROM generate_series(1,$4::int) i`,[users.EMPLOYEE,users.MANAGER,protocol,volume])
    await client.query('COMMIT')
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  // Refresh statistics on the disposable fixture only; never create an index.
  await pool.query('ANALYZE expense_notes');await pool.query('ANALYZE users')
  const digest=(await pool.query("SELECT md5(string_agg(concat(amount,'|',expense_date,'|',description,'|',status,'|',created_at),E'\\n' ORDER BY description)) AS digest FROM expense_notes WHERE description LIKE $1",[protocol+':%'])).rows[0].digest
  const distribution=(await pool.query('SELECT status,count(*)::int AS count FROM expense_notes WHERE description LIKE $1 GROUP BY status ORDER BY status',[protocol+':%'])).rows
  json(marker,{protocol,runId:config.id,volume,company,users,domain,distribution,digest})
  console.log(JSON.stringify({prepared:volume,distribution,extraSeedNotes:2,receipts:'No S3 receipt per generated list row; OCR uses versioned PNG corpus separately.'}))
  await provisionRuntime(pool,config.runtimePassword)
  await limitedRuntime();await runtimePool.end();runtimePool=undefined
  command(['run','build'])
}
async function start() {
  await new Promise((resolve,reject)=>{const probe=createServer();probe.once('error',()=>reject(Error('Benchmark app port occupied; no listener stopped.')));probe.listen(config.appPort,'127.0.0.1',()=>probe.close(resolve))})
  server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(config.appPort)],{cwd:root,env:benchmarkWebEnvironment(config),detached:true,stdio:['ignore','pipe','pipe']})
  server.stdout.on('data',x=>{if(serverOutput.length<2e6)serverOutput+=x});server.stderr.on('data',x=>{if(serverOutput.length<2e6)serverOutput+=x})
  server.on('error',()=>{expired=true})
  for(let i=0;i<150;i++){if(expired||server.exitCode!==null)break;try{const r=await fetch(config.baseURL+'/login',{signal:AbortSignal.timeout(1000)});if(r.status===200)return}catch{}await delay(200)}throw Error('Owned benchmark server not ready within 30s.')
}
function stop(){try{if(server&&server.exitCode===null)process.kill(-server.pid,'SIGTERM')}catch{ /* Already stopped. */ }}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{expired=true;stop()})
async function measured(client,scenario,pass,index,phase='measured') {
  if(expired)throw Error('Benchmark duration limit reached.')
  const t=performance.now();let status=null,bytes=0,ok=false,error=null
  try {
    const r=await client.get(scenario.route,{timeout:10000});status=r.status();const body=await r.body();bytes=body.length
    if(status===200){const rows=JSON.parse(body.toString());ok=Array.isArray(rows)&&rows.length===scenario.expected;if(!ok)error='unexpected-row-count'}else error='http-error'
  }catch(e){error=e.name==='TimeoutError'?'timeout':'request-error'}
  observations.push({scenario:scenario.name,pass,index,phase,status,bytes,ms:Number((performance.now()-t).toFixed(3)),ok,error})
}
async function run() {
  readConfig(); const preparationDb=await identity(), db=await limitedRuntime(), fixture=JSON.parse(readFileSync(marker,'utf8'))
  if(fixture.protocol!==protocol||fixture.runId!==config.id||![1000,10000].includes(fixture.volume))throw Error('Benchmark fixture marker does not match owned target.')
  const actual=Number((await pool.query('SELECT count(*) AS count FROM expense_notes WHERE description LIKE $1',[protocol+':%'])).rows[0].count)
  if(actual!==fixture.volume)throw Error('Dataset volume differs from the prepared fixture.')
  const volume=fixture.volume, out=path.join(root,'docs/performance/results/post-rls-20261023',String(volume));mkdirSync(out,{recursive:true});let outcome='failed'
  for(const file of ['summary.json','http.json','sql-plans.json','ocr.json','outcome.json'])rmSync(path.join(out,file),{force:true})
  const git=args=>{const r=spawnSync('git',args,{encoding:'utf8',timeout:5000});if(r.status!==0)throw Error('Source metadata unavailable');return r.stdout.trim()}
  const hashes=Object.fromEntries(['scripts/bench.mjs','scripts/mathis/MATH-05/metrics.mjs','scripts/mathis/MATH-05/runtime.mjs','src/lib/runtime-database.ts','src/lib/expense-access.ts','src/lib/pagination.ts','src/lib/ocr.ts','src/lib/ocr-parser.ts','package-lock.json',...['expense-notes','manager/expense-notes','hr/expense-notes'].map(x=>`src/app/api/${x}/route.ts`)].map(f=>[f,createHash('sha256').update(readFileSync(f)).digest('hex')]))
  json(path.join(out,'conditions.json'),{protocol,at:new Date().toISOString(),timezone:'Europe/Paris',sha:git(['rev-parse','HEAD']),workingTree:git(['status','--porcelain'])||'clean',hashes,node:process.version,npm:process.env.npm_config_user_agent,os:{platform:os.platform(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,totalMemory:os.totalmem(),freeMemory:os.freemem(),loadAverage:os.loadavg()},db,preparationDb,webEnvironment:{maintenanceCredentials:false,bootstrapException:false},fixture:{protocol:fixture.protocol,volume:fixture.volume,distribution:fixture.distribution,digest:fixture.digest,extraSeedCompanies:1,extraSeedUsers:3,extraSeedNotes:2,benchmarkCompanies:1,benchmarkUsers:3},passes,concurrency,requestsPerPass,pagination:'legacy full lists intentionally retained; opt-in page/pageSize available on measured main but not mixed into this workload',warmup:'3 GETs per route excluded and preserved separately; OS/DB caches not flushed',receiptBytesPerListRow:0,otherServices:'Colima Docker plus local slide preview; hosted GitHub CI external. No claim of exclusive host.',limits:'actual expense_web runtime with HA-04 startup check; SQL plans under the same restricted role; this benchmark is not the exhaustive security matrix or a production capacity test; OCR below is a standalone diagnostic, not the bounded HTTP OCR pool'})
  const timer=setTimeout(()=>{expired=true;stop();const hard=setTimeout(()=>{console.error('Benchmark exceeded its global duration limit.');process.exit(1)},10000);hard.unref()},480000)
  try {
    await start()
    const anonymous=await request.newContext({baseURL:config.baseURL});contexts.push(anonymous);await measured(anonymous,{name:'negative-control-anonymous',route:'/api/expense-notes',expected:0},0,0,'diagnostic');if(observations.at(-1).status!==401)throw Error('Anonymous control did not yield 401.')
    const definitions=[{name:'employee',key:'EMPLOYEE',route:'/api/expense-notes',expected:volume/2,sql:'SELECT * FROM expense_notes WHERE user_id = $1 ORDER BY created_at DESC, id DESC'},
      {name:'manager',key:'MANAGER',route:'/api/manager/expense-notes',expected:volume*.4,sql:`SELECT en.*, u.name AS author_name FROM expense_notes en JOIN users u ON u.id = en.user_id WHERE ${expenseValidatorSql('manager',1,2)} AND en.status = 'pending' ORDER BY created_at ASC, id ASC`},
      {name:'hr',key:'HR',route:'/api/hr/expense-notes',expected:volume*.3,sql:`SELECT en.*, u.name AS author_name FROM expense_notes en JOIN users u ON u.id = en.user_id WHERE ${expenseValidatorSql('hr_admin',1,2)} AND en.status = 'pending' ORDER BY created_at ASC, id ASC`}]
    for(const scenario of definitions){
      const client=await request.newContext({baseURL:config.baseURL,timeout:10000});contexts.push(client);scenario.client=client
      const csrf=await(await client.get('/api/auth/csrf')).json()
      const login=await client.post('/api/auth/callback/credentials',{form:{csrfToken:csrf.csrfToken,email:`${scenario.key.toLowerCase()}@${fixture.domain}`,password:config.fixturePassword,callbackUrl:config.baseURL+'/expenses'},maxRedirects:0})
      const session=await(await client.get('/api/auth/session')).json()
      if(login.status()!==302||session.user?.id!==fixture.users[scenario.key])throw Error('Synthetic benchmark authentication failed.')
      for(let i=0;i<3;i++)await measured(client,scenario,0,i,'warmup')
      for(let pass=1;pass<=passes;pass++){
        let next=0;await Promise.all(Array.from({length:concurrency},async()=>{while(next<requestsPerPass){const index=next++;await measured(client,scenario,pass,index)}}))
        const values=scenario.key==='EMPLOYEE'?[fixture.users[scenario.key]]:[fixture.users[scenario.key],fixture.company]
        await runtimePool.query('BEGIN');try{await runtimePool.query("SELECT set_config('app.current_user_id',$1,true)",[fixture.users[scenario.key]]);const plan=(await runtimePool.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+scenario.sql,values)).rows[0]['QUERY PLAN'];sqlPlans.push({scenario:scenario.name,pass,role:db.role,sql:scenario.sql,plan})}finally{await runtimePool.query('ROLLBACK')}
      }
    }
    // Load the existing parser unchanged, using Node's native TypeScript stripping.
    const hooks=registerHooks({resolve(specifier,context,next){return next(specifier==='@/utils/validators'?pathToFileURL(path.join(root,'src/utils/validators.ts')).href:specifier,context)}})
    const {parseReceiptText}=await import(pathToFileURL(path.join(root,'src/lib/ocr-parser.ts')).href);hooks.deregister()
    const corpus=JSON.parse(readFileSync('tests/fixtures/leandro/LE-04/images.json','utf8'))
    for(let pass=1;pass<=passes;pass++){
      if(expired)throw Error('Benchmark duration limit reached.')
      const before=process.cpuUsage(),t=performance.now();const pending=createWorker('fra',undefined,{langPath:path.join(root,'tessdata'),cacheMethod:'none'});const worker=await bounded(pending,()=>{pending.then(w=>w.terminate()).catch(()=>{})})
      ocr.push({kind:'worker-init',pass,ms:performance.now()-t,cpuMicros:process.cpuUsage(before),maxRssKiB:process.resourceUsage().maxRSS})
      try{for(let i=0;i<corpus.length;i++){
        if(expired)throw Error('Benchmark duration limit reached.')
        const f=corpus[i],file=path.join(root,'tests/fixtures/leandro/LE-04/images',f.id+'.png'),start=performance.now(),cpu=process.cpuUsage()
        const {data:{text}}=await bounded(worker.recognize(file),()=>worker.terminate());const ms=performance.now()-start;const parserStart=performance.now();const result=parseReceiptText(text),parserMs=performance.now()-parserStart
        const control=parseReceiptText(f.lines.join('\n'));const same=(a,b)=>a.amount===b.amount&&a.expenseDate===b.expenseDate
        ocr.push({kind:'real-ocr',pass,id:f.id,bytes:readFileSync(file).length,sha256:createHash('sha256').update(readFileSync(file)).digest('hex'),worker:i===0?'first-recognition-after-init':'reused-worker',ms,parserMs,cpuMicros:process.cpuUsage(cpu),maxRssKiB:process.resourceUsage().maxRSS,text,result,expected:f.expected,correct:same(result,f.expected),pureTextParserCorrect:same(control,f.expected)})
      }}finally{await worker.terminate()}
    }
    json(path.join(out,'summary.json'),{lists:definitions.map(s=>({scenario:s.name,all:summarize(observations.filter(r=>r.scenario===s.name&&r.phase==='measured')),passes:[1,2,3].map(pass=>({pass,...summarize(observations.filter(r=>r.scenario===s.name&&r.pass===pass))}))})),diagnostic:summarize(observations.filter(r=>r.phase==='diagnostic')),warmups:summarize(observations.filter(r=>r.phase==='warmup')),ocr:{recognitions:ocr.filter(r=>r.kind==='real-ocr').length,correct:ocr.filter(r=>r.correct).length,pureTextParserCorrect:ocr.filter(r=>r.pureTextParserCorrect).length,percentile:null,note:'Small synthetic corpus; report individual values, no population precision or OCR p95.'}})
    console.log(`Measured ${volume} notes: ${observations.length} HTTP attempts (including 9 explicit warmups), ${sqlPlans.length} SELECT plans, ${ocr.filter(r=>r.kind==='real-ocr').length} real OCR recognitions.`)
    if(observations.some(r=>r.phase!=='diagnostic'&&!r.ok)||ocr.some(r=>r.kind==='real-ocr'&&(!r.correct||!r.pureTextParserCorrect)))throw Error('Measured errors retained; inspect the raw results.')
    outcome='passed'
  }finally{clearTimeout(timer);json(path.join(out,'outcome.json'),{outcome,expired,httpAttempts:observations.length,sqlPlans:sqlPlans.length,realOcrRecognitions:ocr.filter(r=>r.kind==='real-ocr').length});stop();await delay(500);try{if(server&&server.exitCode===null)process.kill(-server.pid,'SIGKILL')}catch{}for(const c of contexts)await c.dispose();json(path.join(out,'http.json'),observations);json(path.join(out,'sql-plans.json'),sqlPlans);json(path.join(out,'ocr.json'),ocr);writeFileSync(path.join(out,'server.log'),redactTestOutput(serverOutput,config))}
}
try{if(action==='prepare')await prepare();else if(action==='run')await run();else if(action==='down'){config=JSON.parse(readFileSync(state,'utf8'));down()}else throw Error('Choose bench:prepare -- 1000|10000, bench:run or bench:down.')}catch(error){failed=true;console.error(redactTestOutput(error.message));process.exitCode=1}finally{await runtimePool?.end();await pool?.end();if(config&&existsSync(state)&&(action==='run'||(action==='prepare'&&failed))){try{down()}catch{console.error('Owned cleanup failed; use bench:down with the retained private configuration.');process.exitCode=1}}}
