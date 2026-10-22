import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Pool } from 'pg'
import { assertLocalDockerEndpoint, createTestConfig, redactTestOutput, summarizeTarget, testEnvironment, validateTestConfig } from './preflight.mjs'

const root = process.cwd()
const runtime = path.join(root, '.test-runtime')
const stateFile = path.join(runtime, 'active.json')
const privateDir = path.join(runtime, 'private')
const action = process.argv[2]
const tasks = { verify: 'verify', collect: 'test:collect', build: 'build', api: 'test:api', e2e: 'test:e2e', smoke: 'test:smoke' }
let config, reportDir, server, serverOutput = '', interrupted = false
const children = new Set()
const journal = []

function terminate(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  try { if (process.platform === 'win32') child.kill('SIGTERM'); else process.kill(-child.pid, 'SIGTERM') } catch { /* Already exited. */ }
}
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => {
  interrupted = true
  for (const child of children) terminate(child)
  terminate(server)
})

function directories() {
  for (const directory of [runtime,privateDir]) {
    if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) throw new Error('Refusing a symlinked test runtime directory.')
    mkdirSync(directory, { recursive: true, mode: 0o700 })
  }
}
function load(create = false) {
  directories()
  if (existsSync(stateFile)) {
    if (lstatSync(stateFile).isSymbolicLink()) throw new Error('Refusing a symlinked test configuration.')
    config = validateTestConfig(JSON.parse(readFileSync(stateFile,'utf8')))
  } else if (create) {
    config = validateTestConfig(createTestConfig())
    writeFileSync(stateFile, JSON.stringify(config), { mode: 0o600, flag: 'wx' })
  } else throw new Error('No active isolated test environment. Run npm run test:prepare first.')
  const target = testEnvironment(config)
  for (const key of ['ARLA_TEST_ENV','ARLA_TEST_BASE_URL','DATABASE_URL','S3_ENDPOINT','S3_BUCKET']) {
    if (process.env[key] !== undefined && process.env[key] !== target[key]) throw new Error(`Conflicting ${key}: unset the external target before using the isolated test stack.`)
  }
  reportDir = path.join(runtime,'reports',config.id)
  mkdirSync(reportDir,{recursive:true,mode:0o700})
  return config
}
const environment = () => ({ ...process.env, ...testEnvironment(config) })
const composeArgs = () => ['compose','-p',config.project,'-f',path.join(root,'docker-compose.test.yml')]

async function run(label, command, args, timeout = 120_000) {
  validateTestConfig(config)
  const started = performance.now()
  const result = await new Promise(resolve => {
    const child = spawn(command,args,{cwd:root,env:environment(),detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']})
    children.add(child)
    let output = '', timedOut = false, overflow = false
    const collect = chunk => {
      if (output.length < 8*1024*1024) output += chunk.toString()
      else { overflow = true; terminate(child) }
    }
    child.stdout.on('data',collect); child.stderr.on('data',collect)
    const timer = setTimeout(() => { timedOut = true; terminate(child) },timeout)
    const hardTimer = setTimeout(() => {
      try { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid,'SIGKILL') } catch { /* Already exited. */ }
    },timeout+5000)
    child.on('error',() => { clearTimeout(timer); clearTimeout(hardTimer); children.delete(child); resolve({code:1,output:'Command could not be started.',timedOut:false,overflow:false}) })
    child.on('close',code => { clearTimeout(timer); clearTimeout(hardTimer); children.delete(child); resolve({code:code??1,output,timedOut,overflow}) })
  })
  const safe = redactTestOutput(result.output,config)
  writeFileSync(path.join(reportDir,`${label}.log`),safe,{mode:0o600})
  const entry = { label, command: [path.basename(command),...args], exitCode:result.code,
    timedOut:result.timedOut, overflow:result.overflow, seconds:Number(((performance.now()-started)/1000).toFixed(3)) }
  journal.push(entry)
  writeFileSync(path.join(reportDir,'commands.json'),JSON.stringify(journal,null,2)+'\n',{mode:0o600})
  console.log(`${label}: exit ${entry.exitCode}, ${entry.seconds}s`)
  if (result.code !== 0 || result.timedOut || result.overflow) {
    console.error(safe.slice(-4000))
    throw new Error(`${label} failed${result.timedOut?' (bounded timeout)':result.overflow?' (output limit)':''}. See the sanitized test reports.`)
  }
  return safe
}
function npm(label,args,timeout) {
  if (!process.env.npm_execpath) throw new Error('Run the documented npm scripts with the pinned Node/npm pair.')
  return run(label,process.execPath,[process.env.npm_execpath,...args],timeout)
}
async function localDocker() {
  if (process.env.DOCKER_HOST) assertLocalDockerEndpoint(process.env.DOCKER_HOST)
  const context = (await run('docker-context','docker',['context','show'])).trim()
  const endpoint = await run('docker-endpoint','docker',['context','inspect',context,'--format','{{(index .Endpoints "docker").Host}}'])
  assertLocalDockerEndpoint(endpoint)
}
async function ownership() {
  const text = await run('owned-containers','docker',['ps','-aq','--filter',`label=com.docker.compose.project=${config.project}`])
  const ids = text.trim().split(/\s+/).filter(Boolean)
  if (ids.length) {
    const objects = JSON.parse(await run('container-labels','docker',['inspect','--format','{{json .Config.Labels}}',...ids]).then(text=>'['+text.trim().split('\n').join(',')+']'))
    if (objects.some(labels => labels['com.docker.compose.project'] !== config.project || labels['io.expense.test-run'] !== config.id)) {
      throw new Error('Project ownership mismatch: refusing to prepare or clean up unowned containers.')
    }
  }
  return ids.length
}
async function freePort(port) {
  await new Promise((resolve,reject) => {
    const probe = createServer()
    probe.once('error',() => reject(new Error(`Dedicated test port ${port} is already occupied. No existing listener was stopped.`)))
    probe.listen(port,'127.0.0.1',() => probe.close(resolve))
  })
}
function runtimeCheck() {
  const node = readFileSync(path.join(root,'.nvmrc'),'utf8').trim()
  const npmVersion = JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).packageManager
  if (process.versions.node !== node || !process.env.npm_config_user_agent?.startsWith(`${npmVersion.replace('@','/')} `)) {
    throw new Error(`Use Node ${node} and ${npmVersion} as pinned for local and CI validation.`)
  }
}
async function prepare() {
  validateTestConfig(config); runtimeCheck()
  const waitSeconds=Number(process.env.ARLA_TEST_READY_TIMEOUT_SECONDS ?? 90)
  if(!Number.isInteger(waitSeconds)||waitSeconds<5||waitSeconds>90)throw new Error('Readiness timeout must be an integer between 5 and 90 seconds.')
  await localDocker()
  if (await ownership()) throw new Error('This test project already exists. Use npm run test:down before preparing a fresh stack.')
  for (const port of [config.appPort,config.authPort,config.dbPort,config.s3Port]) await freePort(port)
  await run('compose-config','docker',[...composeArgs(),'config','--quiet'])
  await run('services-ready','docker',[...composeArgs(),'up','-d','--wait','--wait-timeout',String(waitSeconds)],180_000)
  await ownership()
  const pool = new Pool({connectionString:config.databaseURL,connectionTimeoutMillis:3000,query_timeout:3000})
  try {
    const {rows:[role]} = await pool.query('SELECT current_database() AS database, current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user')
    if (role.database !== config.database || role.role !== 'expense_test') throw new Error('Actual database identity differs from the owned test target.')
    writeFileSync(path.join(reportDir,'database-role.json'),JSON.stringify(role,null,2)+'\n',{mode:0o600})
    console.log('Reference uses the bootstrap DB role; this does not prove RLS. HA-04 remains pending.')
  } finally { await pool.end() }
  const envFile = path.join(privateDir,`${config.id}.env`)
  writeFileSync(envFile,Object.entries(testEnvironment(config)).map(([key,value])=>`${key}=${value}\n`).join(''),{mode:0o600})
  await npm('migrations',['run','migrate:up','--','--envPath',envFile],60_000)
  await npm('bucket',['run','ensure-bucket'],60_000)
  // Initial three-role reference only. Hamza supplies the final two-company fixtures.
  await npm('seed',['run','seed'],60_000)
  console.log(JSON.stringify(summarizeTarget(config)))
}
async function stopServer() {
  if (!server) return
  const child = server
  terminate(child)
  const deadline = Date.now()+5000
  while (child.exitCode===null && child.signalCode===null && Date.now()<deadline) await delay(50)
  if (child.exitCode===null && child.signalCode===null) {
    try { if (process.platform==='win32') child.kill('SIGKILL'); else process.kill(-child.pid,'SIGKILL') } catch { /* Already exited. */ }
  }
  writeFileSync(path.join(reportDir,'production-server.log'),redactTestOutput(serverOutput,config),{mode:0o600})
  server = undefined
}
async function startServer() {
  await freePort(config.appPort)
  server = spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(config.appPort)],{
    cwd:root,env:{...environment(),NODE_ENV:'production'},detached:process.platform!=='win32',stdio:['ignore','pipe','pipe'],
  })
  server.stdout.on('data',chunk=>{ if(serverOutput.length<2*1024*1024)serverOutput+=chunk.toString() })
  server.stderr.on('data',chunk=>{ if(serverOutput.length<2*1024*1024)serverOutput+=chunk.toString() })
  let spawnFailed = false
  server.on('error',()=>{spawnFailed=true})
  const deadline = Date.now()+30_000
  while (Date.now()<deadline) {
    if (interrupted || spawnFailed || server.exitCode!==null || server.signalCode!==null) throw new Error('Owned production server stopped before readiness.')
    try {
      const response = await fetch(`${config.baseURL}/login`,{redirect:'manual',signal:AbortSignal.timeout(1500)})
      if (response.status===200) { console.log('Owned production server ready.'); return }
    } catch { /* Bounded startup wait. */ }
    await delay(150)
  }
  throw new Error('Production HTTP readiness timed out after 30 seconds.')
}
async function task(name) {
  if (!(name in tasks)) throw new Error('Choose verify, collect, build, api, e2e or smoke for test:exec.')
  const args = ['run',tasks[name]]
  const raw = path.join(privateDir,`${config.id}-${name}.json`)
  if (['api','e2e','smoke'].includes(name)) {
    process.env.PLAYWRIGHT_JSON_OUTPUT_NAME = raw
    args.push('--','--reporter=list,json')
  }
  try { await npm(name,args,name==='api'?300_000:180_000) }
  finally {
    delete process.env.PLAYWRIGHT_JSON_OUTPUT_NAME
    if (existsSync(raw)) {
      try { const content=redactTestOutput(readFileSync(raw,'utf8'),config); JSON.parse(content); writeFileSync(path.join(reportDir,`${name}.json`),content,{mode:0o600}) }
      catch { console.log(`${name}: no complete JSON report available; command outcome remains recorded.`) }
    }
  }
}
async function down() {
  validateTestConfig(config); await localDocker(); await ownership()
  await run('cleanup','docker',[...composeArgs(),'down','--volumes','--remove-orphans'],60_000)
  rmSync(stateFile)
}

try {
  if (action==='down' && !existsSync(stateFile) && process.argv.includes('--if-present')) {
    console.log('No active test stack to clean up.')
  } else {
    load(['prepare','ci'].includes(action))
    writeFileSync(path.join(reportDir,'target.json'),JSON.stringify(summarizeTarget(config),null,2)+'\n',{mode:0o600})
    const sha=(await run('source-sha','git',['rev-parse','HEAD'])).trim()
    const status=(await run('source-status','git',['status','--porcelain'])).trim()
    writeFileSync(path.join(reportDir,'run.json'),JSON.stringify({sha,workingTree:status||'clean',node:process.version,npm:process.env.npm_config_user_agent,platform:process.platform,arch:process.arch,at:new Date().toISOString(),timezone:'Europe/Paris',lockSha256:createHash('sha256').update(readFileSync(path.join(root,'package-lock.json'))).digest('hex')},null,2)+'\n',{mode:0o600})
    if (action==='prepare') await prepare()
    else if (action==='down') await down()
    else if (action==='exec') { await localDocker(); if (!await ownership()) throw new Error('No owned test services are running.'); await task(process.argv[3]) }
    else if (action==='serve') {
      await localDocker(); if (!await ownership()) throw new Error('No owned test services are running.')
      await startServer()
      while (!interrupted && server.exitCode===null && server.signalCode===null) await delay(200)
      if (!interrupted) throw new Error('Owned production server exited unexpectedly.')
    } else if (action==='ci') {
      let failed = false
      try {
        runtimeCheck()
        for (const name of ['verify','collect']) { if(interrupted)throw new Error('Test run interrupted.'); await task(name) }
        await prepare()
        await task('build')
        await startServer()
        for (const name of ['api','e2e']) { if(interrupted)throw new Error('Test run interrupted.'); await task(name) }
      } catch (error) { failed=true; console.error(error instanceof Error?error.message:'Test campaign failed.') }
      finally {
        await stopServer()
        try { await down() } catch (error) { failed=true; console.error(error instanceof Error?error.message:'Test cleanup failed.') }
      }
      if (failed || interrupted) process.exitCode=1
    } else throw new Error('Choose prepare, serve, exec, ci or down through the npm scripts.')
  }
} catch (error) {
  console.error(error instanceof Error?error.message:'Isolated test command failed.')
  process.exitCode=1
} finally { await stopServer() }
