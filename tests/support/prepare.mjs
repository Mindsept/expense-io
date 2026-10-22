import { execFile } from 'node:child_process'
import { mkdtemp, rmdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { preflight } from './preflight.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))

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
    // A bad target is rejected before even loading modules capable of mutation.
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
