import { execFile } from 'node:child_process'
import { mkdtemp, rmdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { preflight } from './preflight.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))

async function prepareEmptyRlsDatabase(env) {
  const { Pool } = await import('pg')
  const options = { max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 }
  const admin = new Pool({ ...options, connectionString: env.DATABASE_URL })
  try {
    const existing = await admin.query('SELECT datname FROM pg_database WHERE datname = $1', ['expense_rls_test'])
    if (existing.rows.length === 0) {
      // CREATE DATABASE must run outside a transaction. The identifier is fixed,
      // not an interpolated environment value, and belongs to this test cluster.
      await admin.query('CREATE DATABASE expense_rls_test')
    }
  } finally { await admin.end() }

  const rls = new Pool({ ...options, connectionString: env.HA04_TEST_ADMIN_DATABASE_URL })
  try {
    const state = await rls.query(`SELECT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
        AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    ) AS occupied`)
    if (state.rows[0]?.occupied !== false) throw new Error('HA-04 needs an empty database; existing relations are never removed.')
    // HA-04 owns its schema and role fixtures. Do not migrate or seed this DB.
  } finally { await rls.end() }
}

function seedEnvironment(env) {
  const clean = { AWS_EC2_METADATA_DISABLED: 'true' }
  const names = [
    'PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE',
    'DATABASE_URL', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_REGION', 'S3_FORCE_PATH_STYLE',
    'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY',
  ]
  for (const role of ['HR', 'MANAGER', 'EMPLOYEE']) names.push(`SEED_${role}_EMAIL`, `SEED_${role}_PASSWORD`)
  for (const name of names) if (env[name] !== undefined) clean[name] = env[name]
  return clean
}

async function seed(env) {
  // The existing seed loads dotenv and prints credentials. Run it outside the
  // repository with only validated settings, and never forward its output.
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'arla-ci-seed-'))
  try {
    await new Promise((resolve, reject) => {
      execFile(process.execPath, [path.join(root, 'scripts', 'seed.mjs')], {
        cwd, env: seedEnvironment(env), windowsHide: true, timeout: 90_000,
        maxBuffer: 1024 * 1024, encoding: 'utf8',
      }, error => {
        if (error) reject(new Error('Synthetic fixture seed failed; captured child output is not published.'))
        else resolve()
      })
    })
  } finally {
    // No recursive cleanup: this directory exists only to keep dotenv away
    // from the developer checkout and is expected to remain empty.
    await rmdir(cwd)
  }
}

/**
 * Prepare only the guarded disposable baseline; no RLS policy is changed here.
 * @param {Record<string, string | undefined>} input
 */
export async function prepare(input = process.env) {
  const env = { ...input }
  const metadata = preflight(env)
  let stage = 'loading test dependencies'
  try {
    if (metadata.rlsDatabaseName) {
      stage = 'empty RLS test database preparation'
      await prepareEmptyRlsDatabase(env)
    }
    // A bad target is rejected before even loading modules capable of mutation.
    stage = 'loading test dependencies'
    const [{ runner }, { S3Client, HeadBucketCommand, CreateBucketCommand }] = await Promise.all([
      import('node-pg-migrate'), import('@aws-sdk/client-s3'),
    ])

    stage = 'database migrations'
    const quiet = () => {}
    await runner({
      databaseUrl: { connectionString: env.DATABASE_URL, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 },
      dir: path.join(root, 'migrations'), direction: 'up', migrationsTable: 'pgmigrations',
      checkOrder: true, singleTransaction: true,
      logger: { debug: quiet, info: quiet, warn: quiet, error: quiet },
    })

    stage = 'test bucket preparation'
    const client = new S3Client({
      endpoint: metadata.storageEndpoint, region: 'us-east-1', forcePathStyle: true, maxAttempts: 2,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    })
    try {
      try {
        await client.send(new HeadBucketCommand({ Bucket: metadata.bucket }), { abortSignal: AbortSignal.timeout(10_000) })
      } catch (error) {
        if (error?.$metadata?.httpStatusCode !== 404 && error?.name !== 'NotFound' && error?.name !== 'NoSuchBucket') throw error
        await client.send(new CreateBucketCommand({ Bucket: metadata.bucket }), { abortSignal: AbortSignal.timeout(10_000) })
      }
    } finally { client.destroy() }

    stage = 'synthetic fixture seed'
    await seed(env)
    console.info('Disposable test migrations, bucket and three-role baseline are ready; privileged bootstrap is not RLS evidence.')
    return metadata
  } catch {
    // SDK, pg and child errors may contain connection strings or credentials.
    throw new Error(`Isolated test preparation failed during ${stage}. No child output or connection credentials are published.`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepare().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
