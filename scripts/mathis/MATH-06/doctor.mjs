import { Pool } from 'pg'
import { S3Client, HeadBucketCommand, ListBucketsCommand } from '@aws-sdk/client-s3'

const result = (state, message) => ({ state, message })
/**
 * All queries are enclosed in a READ ONLY transaction. No schema/fixture/S3 writes.
 * @param {Record<string,string|undefined> | {env:Record<string,string>,webURL:string}} input
 */
export async function doctor(input = process.env, dependencies = {}) {
  const env = input.env ? { ...input.env, DATABASE_URL: input.webURL } : input
  const output = { configuration: result('ok', 'Explicit configuration present.'), database: result('unavailable', 'Check the local PostgreSQL service and the private expense_web connection.'), storage: result('unavailable', 'Check the local S3 service and credentials.'), bucket: result('unavailable', 'Bucket not checked.') }
  let connection, endpoint
  try {
    connection = new URL(env.DATABASE_URL); endpoint = new URL(env.S3_ENDPOINT)
    if (!['postgres:', 'postgresql:'].includes(connection.protocol) || !['127.0.0.1', 'localhost'].includes(connection.hostname) || !connection.port || connection.search || connection.hash || !['127.0.0.1', 'localhost'].includes(endpoint.hostname) || endpoint.protocol !== 'http:' || !endpoint.port || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || !env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) throw Error()
  } catch {
    output.configuration = result('missing', 'Provide DATABASE_URL, S3_ENDPOINT, S3_BUCKET and private S3 credentials explicitly; no .env is loaded.')
    return { ok: false, components: output }
  }
  const pool = dependencies.pool ?? new Pool({ connectionString: env.DATABASE_URL, max: 1, connectionTimeoutMillis: 2500, statement_timeout: 2500, query_timeout: 3000 })
  const s3 = dependencies.s3 ?? new S3Client({ endpoint: endpoint.origin, region: env.S3_REGION || 'us-east-1', forcePathStyle: true, maxAttempts: 1, credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } })
  await Promise.all([
    (async () => {
      let client
      try {
        client = await pool.connect()
        await client.query('BEGIN READ ONLY')
        const { rows: [identity] } = await client.query('SELECT current_user AS role,session_user AS login,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication,rolinherit FROM pg_roles WHERE rolname=current_user')
        output.database = identity?.role === 'expense_web' && identity.login === 'expense_web' && !['rolsuper', 'rolbypassrls', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolinherit'].some(key => identity[key])
          ? result('ok', 'PostgreSQL answered a read-only query with the actual restricted expense_web login; this is not a complete RLS audit.')
          : result('unsafe', 'PostgreSQL answered, but the actual login is not the restricted HA-04 runtime role. Review its provisioning; do not run the application as administrator.')
      } catch { /* Stable, non-secret diagnostic retained. */ }
      finally { if (client) { try { await client.query('ROLLBACK') } catch {} client.release() } if (!dependencies.pool) await pool.end() }
    })(),
    (async () => {
      try {
        await s3.send(new ListBucketsCommand({}), { abortSignal: AbortSignal.timeout(2500) })
        output.storage = result('ok', 'Authenticated S3 API responded; an open TCP port alone is not used as readiness.')
        try {
          await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }), { abortSignal: AbortSignal.timeout(2500) })
          output.bucket = result('ok', 'Configured bucket is present and accessible; no bucket or object was created.')
        } catch (error) {
          output.bucket = error?.$metadata?.httpStatusCode === 404
            ? result('missing', 'Configured bucket is absent. Run the explicit isolated preparation if this is a disposable demo.')
            : result('unavailable', 'Bucket access failed; check authorization/service state. No creation attempted.')
        }
      } catch { /* Do not print SDK messages containing credentials/URLs. */ }
      finally { if (!dependencies.s3) s3.destroy() }
    })(),
  ])
  return { ok: Object.values(output).every(component => component.state === 'ok'), components: output }
}
