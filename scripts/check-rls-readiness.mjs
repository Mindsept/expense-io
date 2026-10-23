import { Client } from 'pg'
import { inspectRls } from './rls/readiness.mjs'

// Explicit invocation only; never called by application startup or migrations.
const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is required. Supply the application connection privately.')
  process.exitCode = 2
} else {
  let client
  try {
    client = new Client({ connectionString, connectionTimeoutMillis: 5_000, statement_timeout: 5_000 })
    await client.connect()
    await client.query('BEGIN READ ONLY')
    const report = await inspectRls(client)
    await client.query('COMMIT')
    console.log(JSON.stringify(report, null, 2))
    process.exitCode = report.issues.length ? 1 : 0
  } catch {
    // Connection/query errors can contain a host, URL or credentials.
    console.error('RLS inspection failed; check the private connection and database access.')
    process.exitCode = 2
  } finally {
    await client?.end().catch(() => {})
  }
}
