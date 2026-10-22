import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { preflight } from './preflight.mjs'
import { spawnOwnedProcess, spawnOwnedNodeProcess, stopOwnedNodeProcess } from './process-tree.mjs'

// A fresh configuration for each invocation. No development .env is read or written.
const secret = () => randomBytes(32).toString('hex')
const env = { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
  ARLA_TEST_ENV: 'isolated', ARLA_TEST_PROJECT: `arla-ci-${randomBytes(6).toString('hex')}`,
  ARLA_TEST_BASE_URL: 'http://127.0.0.1:3199', ARLA_TEST_DB_PORT: '55440', ARLA_TEST_S3_PORT: '45740',
  POSTGRES_USER: 'expense_test', POSTGRES_DB: 'expense_io_test', POSTGRES_PASSWORD: secret(),
  S3_ENDPOINT: 'http://127.0.0.1:45740', S3_REGION: 'us-east-1', S3_BUCKET: 'receipts-ci-test',
  S3_ACCESS_KEY_ID: 'test', S3_SECRET_ACCESS_KEY: 'test', S3_FORCE_PATH_STYLE: 'true',
  AUTH_SECRET: secret(), AUTH_TRUST_HOST: 'true', AUTH_URL: 'http://127.0.0.1:3199',
  HA01_SERVER_MODE: 'production', HA01_TEST_PORT: '3198', HA07_TEST_PASSWORD: secret(),
}
// Never inherit a TLS verification bypass into the application or dependency downloads.
delete env.NODE_TLS_REJECT_UNAUTHORIZED
env.DATABASE_URL = `postgres://expense_test:${env.POSTGRES_PASSWORD}@127.0.0.1:55440/expense_io_test`
for (const owner of ['HA01', 'HA02', 'HA03', 'HA05', 'HA06', 'HA07', 'LE01', 'LE04', 'LE12']) {
  env[`${owner}_TEST_DATABASE_URL`] = env.DATABASE_URL
  env[`${owner}_TEST_BASE_URL`] = env.ARLA_TEST_BASE_URL
  env[`${owner}_TEST_PASSWORD`] = secret()
}
// Readiness tests in HA-04 deliberately inspect the bootstrap connection.
env.HA04_TEST_ADMIN_DATABASE_URL = env.DATABASE_URL.replace('/expense_io_test', '/expense_rls_test')
for (const role of ['EMPLOYEE', 'MANAGER', 'HR']) {
  env[`ARLA_TEST_${role}_EMAIL`] = env[`SEED_${role}_EMAIL`] = `${role.toLowerCase()}@expense.test`
  env[`ARLA_TEST_${role}_PASSWORD`] = env[`SEED_${role}_PASSWORD`] = secret()
}
const confidential = Object.entries(env).filter(([key]) => /PASSWORD|AUTH_SECRET|DATABASE_URL/.test(key))
  .map(([, value]) => value).filter(Boolean).sort((a, b) => b.length - a.length)
function redact(text) {
  let safe = String(text)
  for (const value of confidential) safe = safe.split(value).join('[REDACTED]')
  return safe.replace(/https?:\/\/[^\s"<>]*[?&]X-Amz-[^\s"<>]*/gi, '[SIGNED RECEIPT URL REDACTED]')
    .replace(/(?:authjs|next-auth)\.(?:session-token|csrf-token)=[^;\s]+/gi, '[AUTH COOKIE REDACTED]')
}
const output = path.resolve('.ci-output')
await mkdir(output, { recursive: true })
const steps = []
let app
let appLog = ''
let composeAttempted = false
let failure
const npm = process.env.npm_execpath
if (!npm) throw new Error('Run this sequence with npm run test:ci.')
const compose = ['compose', '-p', env.ARLA_TEST_PROJECT, '-f', 'docker-compose.test.yml']

async function run(name, command, args, timeout = 300_000) {
  console.log(`\n[CI] ${name}`)
  const started = Date.now()
  let log = ''
  const child = spawnOwnedProcess(command, args, { env })
  child.stdout.on('data', data => { log += data })
  child.stderr.on('data', data => { log += data })
  let code
  let timer
  let runError
  try {
    code = await Promise.race([
      new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${name} timed out.`)), timeout) }),
    ])
  } catch (error) {
    runError = error
  } finally {
    clearTimeout(timer)
    if (child.pid) {
      try { await stopOwnedNodeProcess(child) }
      catch (error) { runError ??= error }
    }
    await writeFile(path.join(output, `${name}.log`), redact(log))
  }
  const safe = redact(log)
  await writeFile(path.join(output, `${name}.log`), safe)
  console.log(safe)
  steps.push({ name, exitCode: code ?? null, durationMs: Date.now() - started,
    error: runError ? redact(runError.message) : undefined })
  if (runError) throw runError
  if (code !== 0) throw new Error(`${name} failed (exit ${code ?? 'terminated'}). See .ci-output/${name}.log.`)
  return log
}
async function vacant(port) {
  await new Promise((resolve, reject) => {
    const socket = net.createServer()
    socket.once('error', () => reject(new Error(`Dedicated test port ${port} is already occupied; nothing will be stopped.`)))
    socket.listen(port, '127.0.0.1', () => socket.close(resolve))
  })
}
async function ready() {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (app.exitCode !== null) throw new Error('Production test server exited before HTTP readiness.')
    try {
      const response = await fetch(`${env.ARLA_TEST_BASE_URL}/api/auth/csrf`, { signal: AbortSignal.timeout(2_000) })
      if (response.ok && typeof (await response.json()).csrfToken === 'string') return
    } catch { /* Bounded startup polling, not a test assertion delay. */ }
    await delay(250)
  }
  throw new Error('Production server did not become ready within 60 seconds.')
}
try {
  console.log('[CI] target', JSON.stringify(preflight(env)))
  // Refuse occupied ports before Compose can touch any service.
  await Promise.all([3199, 3198, 55440, 45740].map(vacant))
  await run('verify', process.execPath, [npm, 'run', 'verify'])
  await run('collect', process.execPath, [npm, 'run', 'test:collect'])
  preflight(env)
  composeAttempted = true
  await run('services', 'docker', [...compose, 'up', '-d', '--wait', '--wait-timeout', '180'])
  await run('prepare', process.execPath, [npm, 'run', 'test:prepare'])
  await run('build', process.execPath, [npm, 'run', 'build'])
  app = spawnOwnedNodeProcess([path.resolve('node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3199'], { env })
  app.stdout.on('data', data => { appLog += data })
  app.stderr.on('data', data => { appLog += data })
  await ready()
  await run('api', process.execPath, [npm, 'run', 'test:api'], 600_000)
  await run('e2e', process.execPath, [npm, 'run', 'test:e2e'], 600_000)
} catch (error) {
  failure = error
  console.error(redact(error instanceof Error ? error.message : error))
} finally {
  try { if (app) await stopOwnedNodeProcess(app) }
  catch (error) { failure ??= error; console.error('Failed to stop the owned production server.') }
  await writeFile(path.join(output, 'production.log'), redact(appLog))
  if (composeAttempted) {
    try {
      preflight(env)
      if (failure) {
        for (const [name, args] of [
          ['service-logs', [...compose, 'logs', '--no-color', '--tail', '80']],
          ['service-state', [...compose, 'ps', '--all', '--format', 'json']],
          ['storage-health', [...compose, 'exec', '-T', 'localstack', 'awslocal', 's3api', 'list-buckets']],
        ]) {
          try { await run(name, 'docker', args, 20_000) }
          catch { console.error(`[CI] ${name} diagnostic failed; original failure remains blocking.`) }
        }
      }
      await run('cleanup', 'docker', [...compose, 'down', '--volumes', '--remove-orphans'], 120_000)
    } catch (error) { failure ??= error; console.error(redact(error.message)) }
  }
  await writeFile(path.join(output, 'summary.json'), JSON.stringify({
    outcome: failure ? 'failed' : 'passed', node: process.version,
    baseline: 'Privileged bootstrap role; this run does not prove RLS isolation.',
    suites: steps, error: failure ? redact(failure.message) : undefined,
  }, null, 2))
}
if (failure) process.exitCode = 1
