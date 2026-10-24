import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { Pool } from 'pg'
import { prepare } from '../../../tests/support/prepare.mjs'
import { preflight } from '../../../tests/support/preflight.mjs'
import { spawnOwnedNodeProcess, stopOwnedNodeProcess } from '../../../tests/support/process-tree.mjs'
import { writeNewPrivateJson } from './private-files.mjs'
import { provisionRuntime } from '../../rls/provision-runtime.mjs'

const directory=path.resolve('.ci-output/demo'),state=path.join(directory,'runtime.json'),seedFile=path.join(directory,'seed.json')
class DemoEnvironmentError extends Error {}
let config,child,stopping
const action=process.argv[2],confirm=process.argv[3]
const secret=()=>randomBytes(32).toString('hex')
function safeDirectories(){for(const p of [path.resolve('.ci-output'),directory]){if(existsSync(p)&&lstatSync(p).isSymbolicLink())throw new DemoEnvironmentError('Symlinked demo directory refused.');mkdirSync(p,{recursive:true,mode:0o700})}}
function check(){
 preflight(config.env)
 if(config.project!==config.env.ARLA_TEST_PROJECT||!/^arla-ci-demo-[a-f0-9]{12}$/.test(config.project))throw new DemoEnvironmentError('Demo project metadata mismatch.')
 const admin=new URL(config.env.DATABASE_URL),web=new URL(config.webURL)
 if(web.username!=='expense_web'||web.hostname!==admin.hostname||web.port!==admin.port||web.pathname!==admin.pathname||web.password.length<32||web.search||web.hash)throw new DemoEnvironmentError('Only the restricted runtime connection is allowed.')
}
function docker(args){const r=spawnSync('docker',args,{env:{...process.env,...config.env},encoding:'utf8',timeout:180000});if(r.status!==0)throw new DemoEnvironmentError('Owned demo Docker operation failed. Private state retained for recovery.');return r.stdout}
function localDocker(){
 const endpoint=docker(['context','inspect','--format','{{(index .Endpoints "docker").Host}}']).trim()
 const local=x=>x.startsWith('unix:///')||x.startsWith('npipe:////./pipe/docker')
 if(!local(endpoint)||(process.env.DOCKER_HOST&&!local(process.env.DOCKER_HOST)))throw new DemoEnvironmentError('Demo requires a local Docker socket, not a remote daemon.')
}
const compose=()=>['compose','-p',config.project,'-f','docker-compose.test.yml']
function ownership(required=false){const rows=docker(['ps','-a','--filter',`label=com.docker.compose.project=${config.project}`,'--format','{{.Label "arla.test.environment"}} {{.Label "arla.test.project"}}']).trim().split('\n').filter(Boolean);if(rows.length>2||rows.some(x=>x!==`isolated ${config.project}`)||(required&&rows.length!==2))throw new DemoEnvironmentError('Unexpected demo ownership labels.')}
async function vacant(port){await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',()=>reject(new DemoEnvironmentError('Dedicated demo port occupied; no process stopped.')));probe.listen(port,'127.0.0.1',()=>probe.close(resolve))})}
function webEnvironment(){
 const env={DATABASE_URL:config.webURL,NODE_ENV:'production',AWS_EC2_METADATA_DISABLED:'true'}
 for(const key of ['PATH','Path','SYSTEMROOT','SystemRoot','WINDIR','TEMP','TMP','HOME','USERPROFILE'])if(process.env[key]!==undefined)env[key]=process.env[key]
 for(const key of ['S3_ENDPOINT','S3_BUCKET','S3_REGION','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY','S3_FORCE_PATH_STYLE','AUTH_SECRET','AUTH_TRUST_HOST','AUTH_URL','NEXT_TELEMETRY_DISABLED','ARLA_TEST_ENV','ARLA_TEST_PROJECT'])env[key]=config.env[key]
 return env
}
function read(required=true){
 safeDirectories()
 for(const file of [state,...(required||existsSync(seedFile)?[seedFile]:[])]){const stat=lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile()||(process.platform!=='win32'&&(stat.mode&0o077)))throw new DemoEnvironmentError('Private demo configuration required.')}
 config=JSON.parse(readFileSync(state,'utf8'));check();localDocker();ownership(required)
}
async function down(){check();localDocker();ownership();await vacant(3215);docker([...compose(),'down','--volumes','--remove-orphans']);rmSync(state);rmSync(seedFile,{force:true});console.info('Only the explicitly owned disposable demo stack and its private configuration were removed.')}
async function up(){
 safeDirectories();if([state,seedFile].some(file=>lstatSync(file,{throwIfNoEntry:false})))throw new DemoEnvironmentError('Demo private files already exist. Reuse the prepared demo or explicitly reset it; no file is overwritten.')
 const id=randomBytes(6).toString('hex'),env={ARLA_TEST_ENV:'isolated',ARLA_TEST_PROJECT:`arla-ci-demo-${id}`,ARLA_TEST_BASE_URL:'http://127.0.0.1:3215',ARLA_TEST_DB_PORT:'55440',ARLA_TEST_S3_PORT:'45740',HA01_TEST_PORT:'3216',POSTGRES_USER:'expense_test',POSTGRES_DB:'expense_io_test',POSTGRES_PASSWORD:secret(),S3_ENDPOINT:'http://127.0.0.1:45740',S3_BUCKET:'receipts-ci-test',S3_REGION:'us-east-1',S3_ACCESS_KEY_ID:'test',S3_SECRET_ACCESS_KEY:'test',S3_FORCE_PATH_STYLE:'true',AUTH_SECRET:secret(),AUTH_TRUST_HOST:'true',AUTH_URL:'http://127.0.0.1:3215',NEXT_TELEMETRY_DISABLED:'1'}
 env.DATABASE_URL=`postgres://expense_test:${env.POSTGRES_PASSWORD}@127.0.0.1:55440/expense_io_test`
 for(const role of ['HR','MANAGER','EMPLOYEE']){env[`ARLA_TEST_${role}_EMAIL`]=env[`SEED_${role}_EMAIL`]=`${role.toLowerCase()}@expense.test`;env[`ARLA_TEST_${role}_PASSWORD`]=env[`SEED_${role}_PASSWORD`]=secret()}
 const web=new URL(env.DATABASE_URL);web.username='expense_web';web.password=secret()
 config={project:env.ARLA_TEST_PROJECT,env,webURL:web.href};check();localDocker();ownership()
 for(const port of [3215,3216,55440,45740])await vacant(port)
 writeNewPrivateJson(state,config)
 try {
  docker([...compose(),'up','-d','--wait','--wait-timeout','90']);await prepare(env)
  const admin=new Pool({connectionString:env.DATABASE_URL,max:1,connectionTimeoutMillis:3000,statement_timeout:5000})
  try{await provisionRuntime(admin,decodeURIComponent(web.password))}finally{await admin.end()}
  const seed={...env,SEED_ADMIN_DATABASE_URL:env.DATABASE_URL,SEED_DEMO_ENV:'local-test',SEED_CONFIRM_DATABASE:'expense_io_test'}
  writeNewPrivateJson(seedFile,seed)
  const build=spawnSync(process.execPath,[process.env.npm_execpath,'run','build'],{env:webEnvironment(),encoding:'utf8',timeout:240000,maxBuffer:8*1024*1024})
  if(build.status!==0)throw new DemoEnvironmentError('Demo production build failed; no captured child output or credentials printed.')
  console.info(JSON.stringify({ready:true,project:config.project,url:env.ARLA_TEST_BASE_URL,privateSeedConfiguration:seedFile,guide:'docs/demo.md'}))
 }catch(error){try{await down()}catch{console.error('Owned cleanup incomplete; use demo:down with its explicit confirmation.')}throw error}
}
try{
 if(process.version!==`v${readFileSync('.nvmrc','utf8').trim()}`||!process.env.npm_config_user_agent?.startsWith('npm/11.19.1 '))throw new DemoEnvironmentError('Use pinned Node 24.22.1 / npm 11.19.1 and npm scripts.')
 if(action==='prepare'){if(confirm)throw new DemoEnvironmentError('Unexpected argument.');await up()}
 else if(action==='start'){
  if(confirm)throw new DemoEnvironmentError('Unexpected argument.');read();await vacant(3215)
  child=spawnOwnedNodeProcess(['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3215'],{env:webEnvironment()})
  child.stdout.on('data',()=>{});child.stderr.on('data',()=>{})
  const stop=()=>{stopping??=stopOwnedNodeProcess(child).catch(()=>{process.exitCode=1});return stopping}
  // npm/terminal can forward the same signal twice; keep handlers installed
  // until the owned child is gone instead of restoring the default on signal 2.
  for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.on(signal,()=>{void stop()})
  process.on('exit',()=>{
   if(process.platform!=='win32'&&child.pid&&child.exitCode===null&&child.signalCode===null){try{process.kill(-child.pid,'SIGTERM')}catch{ /* Only the group created above. */ }}
  })
  let ready=false
  for(let i=0;i<150;i++){if(child.exitCode!==null)break;try{if((await fetch(config.env.ARLA_TEST_BASE_URL+'/login',{signal:AbortSignal.timeout(1000)})).ok){ready=true;break}}catch{}await delay(200)}
  if(!ready&&!stopping)throw new DemoEnvironmentError('Restricted demo server did not become ready.')
  console.info('Demo ready at http://127.0.0.1:3215. Private synthetic credentials remain in .ci-output/demo/seed.json. Ctrl+C stops only this server and preserves the demo data.')
  if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>child.once('exit',resolve))
  await stopping
 }else if(['reset','down'].includes(action)){
  if(confirm!=='--confirm-disposable'||process.argv.length!==4)throw new DemoEnvironmentError('Explicit --confirm-disposable required. Stop demo:start first; this removes only its owned test volumes.')
  read(false);await down();if(action==='reset')await up()
 }else throw new DemoEnvironmentError('Choose demo:prepare, demo:start, demo:reset or demo:down. See docs/demo.md.')
}catch(error){console.error(error instanceof DemoEnvironmentError?error.message:'Demo operation failed. Check the pinned runtime, private configuration and local services; no driver details or credentials are printed.');process.exitCode=1}
finally{if(child&&child.exitCode===null)await stopOwnedNodeProcess(child)}
