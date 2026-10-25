import { readFile, writeFile, lstat, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { Pool } from 'pg'
import { runner } from 'node-pg-migrate'
import { HeadBucketCommand, CreateBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { provisionRuntime } from '../../rls/provision-runtime.mjs'
import { root, checkedDemo, newDemo, newTarget, newOutputDirectory, writeNewJson, schemaDigest, toolingDigest, sha256, refuse, noAliases, validateManifest } from './guards.mjs'
import { command, docker, composeArgs, localDocker, ownedContainers, vacant, database, storage, send, objects, receipt, databaseSnapshot, dump, restoreDump } from './services.mjs'
import { verifyHttp, assertCleanAppConfiguration } from './verify-http.mjs'
import { prepare } from '../../../tests/support/prepare.mjs'

async function applicationSha() {
  const applicationPaths = ['src', 'migrations', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'tests/support', 'scripts/rls', 'scripts/seed.mjs']
  // HEAD is meaningful only for the application and shared contracts actually used.
  await command('git', ['diff', '--quiet', 'HEAD', '--', ...applicationPaths])
  if ((await command('git', ['ls-files', '--others', '--exclude-standard', '--', ...applicationPaths])).trim()) refuse('uncommitted_application_files')
  return (await command('git', ['rev-parse', 'HEAD'])).trim()
}
export async function prepareDemo(output, ports) {
  const config = newDemo(ports), meta = checkedDemo(config)
  await localDocker(config); await ownedContainers(config, true)
  for (const port of [meta.appPort, meta.authPort, meta.databasePort, meta.storagePort]) await vacant(port)
  const directory = await newOutputDirectory(output)
  await writeNewJson(path.join(directory, 'runtime.json'), config)
  await docker(config, [...composeArgs(config), 'up', '-d', '--wait', '--wait-timeout', '90'], 120000)
  await ownedContainers(config)
  // MATH-02 owns migrations and the synthetic three-role fixture. No development .env.
  await prepare(config.env)
  const pool = database(config)
  try { await provisionRuntime(pool, decodeURIComponent(new URL(config.webURL).password)) } finally { await pool.end() }
  return { ready: true, project: config.project, database: 'expense_io_test', accounts: 3, runtime: 'expense_web', privateConfiguration: path.join(directory, 'runtime.json') }
}
export async function downDemo(config, confirmed) {
  if (!confirmed) refuse('explicit_disposable_confirmation_required')
  const meta = checkedDemo(config)
  await localDocker(config); await ownedContainers(config); await vacant(meta.appPort)
  await docker(config, [...composeArgs(config), 'down', '--volumes', '--remove-orphans'], 90000)
  return { status: 'owned-demo-services-removed', project: config.project, localFiles: 'Retained; no directory or archive was deleted.' }
}
function checkDeadline(started) { if (Date.now() - started > 180000) refuse('demo_transfer_deadline') }
async function archiveFile(directory, name, maximum = 128 * 1024 * 1024) {
  const file = path.join(directory, name)
  await noAliases(file)
  const entry = await lstat(file)
  if (!entry.isFile() || entry.size > maximum) refuse('invalid_archive_file')
  return readFile(file)
}
export async function backup(config, output, confirmed) {
  if (confirmed !== true) refuse('confirm_stopped_synthetic_demo_required')
  const meta = checkedDemo(config), started = Date.now()
  await localDocker(config)
  const containers = await ownedContainers(config)
  await vacant(meta.appPort)
  const directory = await newOutputDirectory(output)
  await writeNewJson(path.join(directory, 'manifest.json'), { format: 'arla-math06-v1', status: 'incomplete', startedAt: new Date().toISOString() })
  await mkdir(path.join(directory, 'objects'), { mode: 0o700 })
  const pool = database(config), s3 = storage(config)
  let client
  try {
    client = await pool.connect()
    const active = await client.query('SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND backend_type=\'client backend\' AND pid<>pg_backend_pid()')
    if (active.rows[0].count !== 0) refuse('stop_all_demo_clients_before_backup')
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
    await client.query("SET LOCAL lock_timeout='3s'")
    const names = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row => row.tablename)
    if (!names.length || names.some(name => !/^[a-z_]+$/.test(name))) refuse('unexpected_schema')
    // SHARE blocks all DML for the complete DB/object capture; no persistent DB writes.
    await client.query(`LOCK TABLE ${names.map(name => `public."${name}"`).join(',')} IN SHARE MODE`)
    const snapshot = (await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot
    const state = await databaseSnapshot(client)
    const inventory = await objects(config, s3), saved = []
    let total = 0
    for (const item of inventory) {
      checkDeadline(started)
      const object = await receipt(config, s3, item.Key)
      total += object.metadata.bytes
      if (total > 128 * 1024 * 1024) refuse('demo_archive_size_limit')
      await writeFile(path.join(directory, 'objects', sha256(item.Key) + '.bin'), object.body, { flag: 'wx', mode: 0o600 })
      saved.push(object.metadata)
    }
    if (saved.length < 2 || state.receiptReferences.length < 2 || state.receiptReferences.some(key => !saved.some(item => item.key === key))) refuse('missing_demo_receipts')
    const databaseFile = await dump(config, containers.postgres, snapshot, path.join(directory, 'database.dump'))
    // Detect object changes even when an outside client ignores the stopped-writers procedure.
    const after = await objects(config, s3)
    if (JSON.stringify(after.map(item => item.Key)) !== JSON.stringify(inventory.map(item => item.Key))) refuse('objects_changed_during_capture')
    for (const expected of saved) { checkDeadline(started); if (JSON.stringify((await receipt(config, s3, expected.key)).metadata) !== JSON.stringify(expected)) refuse('objects_changed_during_capture') }
    await vacant(meta.appPort)
    await client.query('ROLLBACK')
    const manifest = { format: 'arla-math06-v1', status: 'exported-unverified', createdAt: new Date().toISOString(), applicationSha: await applicationSha(), schemaSha: await schemaDigest(), toolingSha: await toolingDigest(), postgresMajor: 16, database: databaseFile, ...state, objects: saved, durationMs: Date.now() - started, consistency: 'All demo writers explicitly stopped; public tables held in SHARE lock and pg_dump imports the same snapshot; S3 contents re-read and hashed before release.', verification: 'A successful export is not a verified backup. A separate restore-verification.json is required.' }
    validateManifest(manifest)
    // The one manifest belongs to this newly-created output only; failures leave incomplete state.
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 })
    return { status: manifest.status, accounts: state.accounts, receipts: saved.length, durationMs: manifest.durationMs }
  } finally { if (client) { try { await client.query('ROLLBACK') } catch {} client.release() } await pool.end(); s3.destroy() }
}

export async function restore(source, archive, output, ports) {
  checkedDemo(source)
  await assertCleanAppConfiguration()
  if (!path.isAbsolute(archive)) refuse('absolute_archive_required')
  await noAliases(archive)
  const manifestBytes = await archiveFile(archive, 'manifest.json', 2 * 1024 * 1024), manifestHash = sha256(manifestBytes)
  const manifest = validateManifest(JSON.parse(manifestBytes.toString('utf8')))
  if (manifest.schemaSha !== await schemaDigest() || manifest.applicationSha !== await applicationSha() || manifest.toolingSha !== await toolingDigest()) refuse('archive_source_revision_mismatch')
  const dumpBytes = await archiveFile(archive, 'database.dump')
  if (dumpBytes.length !== manifest.database.bytes || sha256(dumpBytes) !== manifest.database.sha256) refuse('database_archive_integrity_failed')
  // Validate every file before creating any target, not only when each object is uploaded.
  for (const expected of manifest.objects) {
    const bytes = await archiveFile(archive, path.join('objects', sha256(expected.key) + '.bin'), 10 * 1024 * 1024)
    if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) refuse('object_archive_integrity_failed')
  }
  const config = newTarget(source, ports), meta = checkedDemo(config), started = Date.now()
  await localDocker(config); await ownedContainers(config, true)
  for (const port of [meta.appPort, meta.authPort, meta.databasePort, meta.storagePort]) await vacant(port)
  const directory = await newOutputDirectory(output)
  await writeNewJson(path.join(directory, 'runtime.json'), config)
  await writeNewJson(path.join(directory, 'restore-state.json'), { status: 'incomplete', project: config.project, startedAt: new Date().toISOString() })
  // Failure leaves this precisely identified disposable target for inspection; no automatic deletion.
  await docker(config, [...composeArgs(config), 'up', '-d', '--wait', '--wait-timeout', '90'], 120000)
  const containers = await ownedContainers(config)
  const pool = database(config), s3 = storage(config)
  try {
    const occupied = await pool.query("SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_' AND c.relkind IN ('r','p','v','m','S','f')")
    if (occupied.rows[0].count !== 0) refuse('existing_target_database_refused')
    // Cluster-wide roles come exclusively from Hamza's unchanged migrations, in a
    // separate new provisioning DB. The actual restore DB remains completely empty.
    await pool.query('CREATE DATABASE math06_roles_test')
    const rolesURL = new URL(config.env.DATABASE_URL); rolesURL.pathname = '/math06_roles_test'
    const quiet = () => {}
    await runner({ databaseUrl: { connectionString: rolesURL.href, connectionTimeoutMillis: 3000, statement_timeout: 30000 }, dir: path.join(root, 'migrations'), migrationsTable: 'pgmigrations', direction: 'up', checkOrder: true, singleTransaction: true, logger: { debug: quiet, info: quiet, warn: quiet, error: quiet } })
    await restoreDump(config, containers.postgres, dumpBytes)
    // No --no-owner, --clean, --disable-triggers, new role or policy workaround.
    await provisionRuntime(pool, decodeURIComponent(new URL(config.webURL).password))
    try { await send(s3, new HeadBucketCommand({ Bucket: config.env.S3_BUCKET })); refuse('existing_target_bucket_refused') }
    catch (error) { if (error?.$metadata?.httpStatusCode !== 404) throw error }
    await send(s3, new CreateBucketCommand({ Bucket: config.env.S3_BUCKET }))
    for (const expected of manifest.objects) {
      checkDeadline(started)
      const body = await archiveFile(archive, path.join('objects', sha256(expected.key) + '.bin'), 10 * 1024 * 1024)
      if (body.length !== expected.bytes || sha256(body) !== expected.sha256) refuse('object_archive_changed_after_validation')
      await send(s3, new PutObjectCommand({ Bucket: config.env.S3_BUCKET, Key: expected.key, Body: body, ContentType: expected.contentType, IfNoneMatch: '*' }))
      if (JSON.stringify((await receipt(config, s3, expected.key)).metadata) !== JSON.stringify(expected)) refuse('restored_object_integrity_failed')
    }
    const state = await databaseSnapshot(pool)
    if (JSON.stringify(state.tables) !== JSON.stringify(manifest.tables) || JSON.stringify(state.receiptReferences) !== JSON.stringify(manifest.receiptReferences)) refuse('restored_database_integrity_failed')
    const actual = await objects(config, s3)
    if (JSON.stringify(actual.map(item => item.Key)) !== JSON.stringify(manifest.objects.map(item => item.key).sort())) refuse('restored_inventory_mismatch')
    const runtime = new Pool({ connectionString: config.webURL, max: 1, connectionTimeoutMillis: 3000, statement_timeout: 3000 })
    try {
      const { rows: [identity] } = await runtime.query('SELECT current_user AS role,session_user AS login,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')
      if (identity?.role !== 'expense_web' || identity.login !== 'expense_web' || identity.rolsuper || identity.rolbypassrls) refuse('restored_runtime_not_restricted')
    } finally { await runtime.end() }
    const http = await verifyHttp(config, manifest)
    if (sha256(await archiveFile(archive, 'manifest.json', 2 * 1024 * 1024)) !== manifestHash) refuse('manifest_changed_during_restore')
    const proof = { status: 'restoration-verified', verifiedAt: new Date().toISOString(), manifestSha: manifestHash, applicationSha: manifest.applicationSha, schemaSha: manifest.schemaSha, toolingSha: manifest.toolingSha, project: config.project, database: 'expense_io_test', accounts: state.accounts, objects: manifest.objects.length, allObjectHashesMatched: true, allTableCountsAndDigestsMatched: true, runtime: 'expense_web', http, durationMs: Date.now() - started, humanReview: 'Hamza review and manual browser walkthrough remain separate.' }
    await writeNewJson(path.join(directory, 'restore-verification.json'), proof)
    return proof
  } finally { await pool.end(); s3.destroy() }
}
