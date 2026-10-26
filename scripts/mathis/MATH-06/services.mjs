import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { readFile, stat } from 'node:fs/promises'
import net from 'node:net'
import { Pool } from 'pg'
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3'
import { root, checkedDemo, refuse, sha256 } from './guards.mjs'

const exec = promisify(execFile)
/** @returns {Record<string,string>} */
export function cleanEnvironment(extra = {}) {
  const env = {}
  for (const key of ['PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'ProgramData', 'HOMEDRIVE', 'HOMEPATH', 'DOCKER_CONFIG', 'DOCKER_CONTEXT', 'DOCKER_HOST', 'NODE_USE_SYSTEM_CA']) if (process.env[key] !== undefined) env[key] = process.env[key]
  return { ...env, ...extra }
}
export async function command(executable, args, env = {}, timeout = 15000) {
  try { return (await exec(executable, args, { cwd: root, env: cleanEnvironment(env), windowsHide: true, timeout, maxBuffer: 2 * 1024 * 1024 })).stdout }
  catch { refuse('child_operation_failed_output_suppressed') }
}
export const composeArgs = config => ['compose', '-p', checkedDemo(config).project, '-f', 'docker-compose.test.yml']
export const docker = (config, args, timeout) => command('docker', args, Object.fromEntries(['ARLA_TEST_PROJECT', 'ARLA_TEST_DB_PORT', 'ARLA_TEST_S3_PORT', 'POSTGRES_PASSWORD'].map(key => [key, config.env[key]])), timeout)
export async function localDocker(config) {
  const endpoint = (await docker(config, ['context', 'inspect', '--format', '{{(index .Endpoints "docker").Host}}'])).trim()
  const local = value => value.startsWith('unix:///') || value.startsWith('npipe:////./pipe/docker')
  if (!local(endpoint) || (process.env.DOCKER_HOST && !local(process.env.DOCKER_HOST))) refuse('local_docker_socket_required')
}
export async function ownedContainers(config, fresh = false) {
  checkedDemo(config)
  const ids = (await docker(config, ['ps', '-aq', '--filter', `label=com.docker.compose.project=${config.project}`])).trim().split(/\s+/).filter(Boolean)
  if (fresh) {
    const volumes = (await docker(config, ['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${config.project}`])).trim()
    const networks = (await docker(config, ['network', 'ls', '-q', '--filter', `label=com.docker.compose.project=${config.project}`])).trim()
    if (ids.length || volumes || networks) refuse('existing_target_refused')
    return
  }
  if (ids.length !== 2) refuse('two_owned_services_required')
  const containers = JSON.parse(await docker(config, ['inspect', ...ids]))
  const found = {}
  const meta = checkedDemo(config)
  for (const container of containers) {
    const labels = container.Config?.Labels || {}, service = labels['com.docker.compose.service']
    const internal = service === 'postgres' ? '5432/tcp' : '4566/tcp'
    const port = service === 'postgres' ? meta.databasePort : meta.storagePort
    const bindings = container.NetworkSettings?.Ports?.[internal]
    if (!['postgres', 'localstack'].includes(service) || found[service] || labels['arla.test.environment'] !== 'isolated' || labels['arla.test.project'] !== config.project || labels['com.docker.compose.project'] !== config.project || !container.State?.Running || container.State?.Health?.Status !== 'healthy' || bindings?.length !== 1 || bindings[0].HostIp !== '127.0.0.1' || bindings[0].HostPort !== String(port)) refuse('service_identity_or_loopback_mismatch')
    found[service] = container.Id
  }
  return found
}
export async function vacant(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', () => reject(new Error('Dedicated port occupied; no process was stopped.')))
    server.listen(port, '127.0.0.1', () => server.close(resolve))
  })
}
export const database = config => new Pool({ connectionString: config.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 3000, statement_timeout: 10000, query_timeout: 12000 })
export const storage = config => new S3Client({ endpoint: config.env.S3_ENDPOINT, region: 'us-east-1', forcePathStyle: true, maxAttempts: 1, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } })
export const send = (s3, operation) => s3.send(operation, { abortSignal: AbortSignal.timeout(5000) })

/** Bounded demo only, never a bucket-wide cleanup. */
export async function objects(config, s3) {
  const entries = [], seen = new Set()
  let token
  do {
    const page = await send(s3, new ListObjectsV2Command({ Bucket: config.env.S3_BUCKET, ContinuationToken: token, MaxKeys: 1000 }))
    entries.push(...(page.Contents ?? []))
    if (entries.length > 1000) refuse('demo_object_limit')
    token = page.IsTruncated ? page.NextContinuationToken : undefined
    if (token && seen.has(token)) refuse('storage_pagination_did_not_advance')
    if (token) seen.add(token)
  } while (token)
  return entries.sort((a, b) => a.Key.localeCompare(b.Key))
}
export async function receipt(config, s3, key) {
  if (!/^receipts\/[a-zA-Z0-9._-]{1,150}$/.test(key)) refuse('unexpected_receipt_key')
  const object = await send(s3, new GetObjectCommand({ Bucket: config.env.S3_BUCKET, Key: key }))
  if (!['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(object.ContentType) || !Number.isSafeInteger(object.ContentLength) || object.ContentLength < 1 || object.ContentLength > 10 * 1024 * 1024) { object.Body?.destroy(); refuse('receipt_size_or_type') }
  const chunks = []; let bytes = 0
  const timer = setTimeout(() => object.Body?.destroy(new Error('Bounded receipt read expired.')), 5000)
  try {
    for await (const part of object.Body) { bytes += part.length; if (bytes > 10 * 1024 * 1024) refuse('receipt_size_limit'); chunks.push(part) }
    if (bytes !== object.ContentLength) refuse('receipt_incomplete')
    const body = Buffer.concat(chunks)
    return { body, metadata: { key, bytes, sha256: sha256(body), contentType: object.ContentType } }
  } finally { clearTimeout(timer); object.Body?.destroy() }
}
export async function databaseSnapshot(client) {
  const names = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row => row.tablename)
  if (!names.length || names.some(name => !/^[a-z_]+$/.test(name))) refuse('unexpected_schema')
  const tables = {}
  for (const name of names) {
    const result = await client.query(`SELECT count(*)::int AS count,md5(coalesce(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text),'')) AS digest FROM public."${name}" t`)
    if (result.rows[0].count > 10000) refuse('demo_row_limit')
    tables[name] = result.rows[0]
  }
  const accounts = (await client.query('SELECT email,role,is_active FROM users ORDER BY email')).rows
  const expected = [['employee@expense.test', 'employee'], ['hr@expense.test', 'hr_admin'], ['manager@expense.test', 'manager']]
  if (accounts.length !== 3 || accounts.some((account, index) => account.email !== expected[index][0] || account.role !== expected[index][1] || !account.is_active)) refuse('three_synthetic_accounts_required')
  if ((await client.query("SELECT count(*)::int AS count FROM companies WHERE email_domain<>'expense.test'")).rows[0].count !== 0) refuse('synthetic_company_required')
  const receiptReferences = (await client.query("SELECT DISTINCT receipt_key FROM expense_notes WHERE btrim(receipt_key)<>'' ORDER BY receipt_key")).rows.map(row => row.receipt_key)
  return { tables, accounts: accounts.length, receiptReferences }
}
export async function dump(config, container, snapshot, file) {
  await binaryDocker(config, ['exec', container, 'pg_dump', '--username=expense_test', '--dbname=expense_io_test', '--format=custom', `--snapshot=${snapshot}`, '--lock-wait-timeout=5s'], file, false)
  const metadata = await stat(file)
  if (metadata.size < 1 || metadata.size > 128 * 1024 * 1024) refuse('dump_size_limit')
  return { bytes: metadata.size, sha256: sha256(await readFile(file)) }
}
export async function restoreDump(config, container, verifiedBytes) {
  await binaryDocker(config, ['exec', '-i', container, 'pg_restore', '--username=expense_test', '--dbname=expense_io_test', '--single-transaction', '--exit-on-error'], verifiedBytes, true)
}
async function binaryDocker(config, args, file, input) {
  const child = spawn('docker', args, { cwd: root, env: cleanEnvironment(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const timeout = setTimeout(() => child.kill(), 90000)
  const ended = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('Binary Docker operation failed.'))) })
  child.stderr.resume()
  try {
    if (input) { child.stdout.resume(); await Promise.all([pipeline(Readable.from([file]), child.stdin), ended]) }
    else { child.stdin.end(); await Promise.all([pipeline(child.stdout, createWriteStream(file, { flags: 'wx', mode: 0o600 })), ended]) }
  } finally { clearTimeout(timeout); if (child.exitCode === null) child.kill() }
}
