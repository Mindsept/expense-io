import { Pool } from 'pg'
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { reconcileSubmissions, reconciliationOptions } from '../../../src/lib/submission-reconciliation.mjs'

let pool
let storage
try {
  const args = process.argv.slice(2)
  const options = { apply: false }
  let mode
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]
    if (flag === '--apply' || flag === '--dry-run') {
      if (mode) throw new Error('Invalid options')
      mode = flag; options.apply = flag === '--apply'
    } else {
      const keys = { '--company-id': 'companyId', '--limit': 'limit', '--min-age-ms': 'minAgeMs', '--max-duration-ms': 'maxDurationMs' }
      const key = keys[flag]
      if (!key || options[key] !== undefined || args[index + 1] === undefined) throw new Error('Invalid options')
      const value = args[++index]
      options[key] = key === 'companyId' ? value : /^\d+$/.test(value) ? Number(value) : NaN
    }
  }
  Object.assign(options, reconciliationOptions(options))
  const database = process.env.LE03_MAINTENANCE_DATABASE_URL
  const endpoint = process.env.S3_ENDPOINT
  const bucket = process.env.S3_BUCKET
  const accessKeyId = process.env.S3_ACCESS_KEY_ID, secretAccessKey = process.env.S3_SECRET_ACCESS_KEY
  if (!database || !endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error('Missing explicit maintenance settings')
  // Do not load .env or fall back to the application's connection/credentials.
  pool = new Pool({ connectionString: database, connectionTimeoutMillis: 3000, max: 2 })
  storage = new S3Client({ endpoint, region: process.env.S3_REGION ?? 'us-east-1', forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false', credentials: { accessKeyId, secretAccessKey } })
  const result = await reconcileSubmissions({ ...options, pool, removeReceipt: async (key, timeoutMs) => {
    await storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(timeoutMs) })
  } })
  console.log(JSON.stringify(result))
  if (result.items.some(item => ['invalid_reference', 'cleanup_failed', 'database_error', 'state_unknown'].includes(item.status))) process.exitCode = 1
} catch {
  // Never echo a connection string, object key, CLI value, SQL or caught exception.
  console.error(JSON.stringify({ operation: 'expense.submit.reconcile', code: 'configuration_or_database_failure' }))
  process.exitCode = 2
} finally {
  await pool?.end().catch(() => {})
  storage?.destroy()
}
