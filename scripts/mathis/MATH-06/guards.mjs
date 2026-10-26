import { createHash, randomBytes } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { preflight } from '../../../tests/support/preflight.mjs'

export const root = fileURLToPath(new URL('../../../', import.meta.url))
export const privateRoot = path.join(root, '.ci-output', 'math06')
export class OperationsError extends Error {}
export function refuse(code) { throw new OperationsError(`MATH-06: ${code}. See docs/exploitation-locale.md.`) }
export const sha256 = value => createHash('sha256').update(value).digest('hex')
export const secret = () => randomBytes(32).toString('hex')
export function safeError(error) { return error instanceof OperationsError ? error.message : 'MATH-06 operation failed. Private driver output was suppressed; inspect the runbook and retained local state.' }

export async function noAliases(file) {
  const resolved = path.resolve(file)
  let current = path.parse(resolved).root
  for (const part of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    const entry = await lstat(current).catch(error => { if (error.code !== 'ENOENT') throw error })
    if (entry?.isSymbolicLink()) refuse('symbolic_path_refused')
  }
  return resolved
}
export async function readPrivateConfig(file) {
  if (!file || !path.isAbsolute(file)) refuse('absolute_private_config_required')
  await noAliases(file)
  const stat = await lstat(file)
  if (!stat.isFile() || stat.size > 65536 || (process.platform !== 'win32' && (stat.mode & 0o077))) refuse('private_config_permissions')
  return JSON.parse(await readFile(file, 'utf8'))
}
export function checkedDemo(config) {
  const meta = preflight(config?.env)
  if (config.project !== meta.project || !/^arla-ci-(demo|math06)-[a-f0-9]{12}$/.test(meta.project)) refuse('owned_demo_project_required')
  let web
  try { web = new URL(config.webURL) } catch { refuse('restricted_web_connection_required') }
  if (!['postgres:', 'postgresql:'].includes(web.protocol) || web.hostname !== meta.databaseHost || web.port !== String(meta.databasePort) || web.pathname !== '/expense_io_test' || web.username !== 'expense_web' || web.password.length < 32 || web.search || web.hash) refuse('restricted_web_connection_required')
  return meta
}
export function newTarget(source, ports) {
  checkedDemo(source)
  const env = { ...source.env, ARLA_TEST_PROJECT: `arla-ci-math06-${randomBytes(6).toString('hex')}`,
    ARLA_TEST_BASE_URL: `http://127.0.0.1:${ports.app}`, HA01_TEST_PORT: String(ports.auth),
    ARLA_TEST_DB_PORT: String(ports.db), ARLA_TEST_S3_PORT: String(ports.s3),
    POSTGRES_PASSWORD: secret(), AUTH_SECRET: secret() }
  delete env.HA04_TEST_ADMIN_DATABASE_URL
  env.DATABASE_URL = `postgres://expense_test:${env.POSTGRES_PASSWORD}@127.0.0.1:${ports.db}/expense_io_test`
  env.S3_ENDPOINT = `http://127.0.0.1:${ports.s3}`
  env.AUTH_URL = env.ARLA_TEST_BASE_URL
  const web = new URL(env.DATABASE_URL); web.username = 'expense_web'; web.password = secret()
  const target = { project: env.ARLA_TEST_PROJECT, env, webURL: web.href }
  const sourcePorts = checkedDemo(source), targetPorts = checkedDemo(target)
  const fields = ['appPort', 'authPort', 'databasePort', 'storagePort']
  if (fields.some(field => fields.some(other => sourcePorts[field] === targetPorts[other]))) refuse('new_ports_required')
  return target
}
export function newDemo(ports) {
  /** @type {Record<string,string>} */
  const env = { ARLA_TEST_ENV: 'isolated', ARLA_TEST_PROJECT: `arla-ci-math06-${randomBytes(6).toString('hex')}`,
    ARLA_TEST_BASE_URL: `http://127.0.0.1:${ports.app}`, HA01_TEST_PORT: String(ports.auth), ARLA_TEST_DB_PORT: String(ports.db), ARLA_TEST_S3_PORT: String(ports.s3),
    POSTGRES_USER: 'expense_test', POSTGRES_DB: 'expense_io_test', POSTGRES_PASSWORD: secret(),
    S3_ENDPOINT: `http://127.0.0.1:${ports.s3}`, S3_BUCKET: 'receipts-ci-test', S3_REGION: 'us-east-1', S3_ACCESS_KEY_ID: 'test', S3_SECRET_ACCESS_KEY: 'test', S3_FORCE_PATH_STYLE: 'true',
    AUTH_SECRET: secret(), AUTH_TRUST_HOST: 'true', AUTH_URL: `http://127.0.0.1:${ports.app}`, NEXT_TELEMETRY_DISABLED: '1' }
  env.DATABASE_URL = `postgres://expense_test:${env.POSTGRES_PASSWORD}@127.0.0.1:${ports.db}/expense_io_test`
  for (const role of ['HR', 'MANAGER', 'EMPLOYEE']) { env[`ARLA_TEST_${role}_EMAIL`] = env[`SEED_${role}_EMAIL`] = `${role.toLowerCase()}@expense.test`; env[`ARLA_TEST_${role}_PASSWORD`] = env[`SEED_${role}_PASSWORD`] = secret() }
  const web = new URL(env.DATABASE_URL); web.username = 'expense_web'; web.password = secret()
  const config = { project: env.ARLA_TEST_PROJECT, env, webURL: web.href }; checkedDemo(config); return config
}
export async function newOutputDirectory(file) {
  if (!file || !path.isAbsolute(file)) refuse('absolute_output_required')
  const resolved = await noAliases(file), relative = path.relative(privateRoot, resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) refuse('output_must_be_inside_ignored_math06_directory')
  await mkdir(path.dirname(resolved), { recursive: true, mode: 0o700 })
  // No recursive deletion or implicit overwrite, even after a failed operation.
  await mkdir(resolved, { mode: 0o700 })
  return resolved
}
export async function writeNewJson(file, value) {
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
}
export async function schemaDigest() {
  const names = (await readdir(path.join(root, 'migrations'))).filter(name => name.endsWith('.sql')).sort()
  return sha256(Buffer.concat(await Promise.all(names.map(async name => Buffer.concat([Buffer.from(name + '\0'), await readFile(path.join(root, 'migrations', name))])))))
}
export async function toolingDigest() {
  const directory = path.join(root, 'scripts', 'mathis', 'MATH-06')
  const files = (await readdir(directory)).filter(name => name.endsWith('.mjs')).sort()
  const parts = await Promise.all(files.map(async name => Buffer.concat([Buffer.from(name + '\0'), await readFile(path.join(directory, name))])))
  parts.push(await readFile(path.join(root, 'package.json')), await readFile(path.join(root, 'docker-compose.test.yml')))
  return sha256(Buffer.concat(parts))
}
export function validateManifest(manifest) {
  if (manifest?.format !== 'arla-math06-v1' || manifest.status !== 'exported-unverified' || !/^[0-9a-f]{40}$/.test(manifest.applicationSha) || !/^[0-9a-f]{64}$/.test(manifest.schemaSha) || !/^[0-9a-f]{64}$/.test(manifest.database?.sha256) || !Number.isSafeInteger(manifest.database?.bytes) || manifest.database.bytes < 1 || manifest.database.bytes > 128 * 1024 * 1024 || !Array.isArray(manifest.objects) || manifest.objects.length < 2 || manifest.objects.length > 1000 || manifest.accounts !== 3 || !manifest.tables?.users || !manifest.tables?.expense_notes) refuse('incomplete_or_invalid_manifest')
  const keys = new Set()
  for (const object of manifest.objects) {
    if (typeof object.key !== 'string' || !/^receipts\/[a-zA-Z0-9._-]{1,150}$/.test(object.key) || keys.has(object.key) || !/^[0-9a-f]{64}$/.test(object.sha256) || !Number.isSafeInteger(object.bytes) || object.bytes < 1 || object.bytes > 10 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(object.contentType)) refuse('invalid_receipt_manifest')
    keys.add(object.key)
  }
  if (manifest.objects.reduce((total, object) => total + object.bytes, 0) > 128 * 1024 * 1024) refuse('demo_archive_size_limit')
  if (!Array.isArray(manifest.receiptReferences) || manifest.receiptReferences.length < 2 || manifest.receiptReferences.some(key => !keys.has(key))) refuse('missing_receipt_in_manifest')
  return manifest
}
