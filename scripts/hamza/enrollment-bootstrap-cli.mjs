import { Pool } from 'pg'
import { bootstrapCompany, BootstrapError, validateBootstrapInput } from './enrollment-bootstrap.mjs'

async function main() {
  // No .env loading or DATABASE_URL fallback. Input stays off argv and logs.
  if (process.argv.length !== 3 || process.argv[2] !== '--apply' || !process.env.HA05_BOOTSTRAP_DATABASE_URL) {
    console.error('Explicit --apply and private HA05_BOOTSTRAP_DATABASE_URL are required; supply JSON on stdin.')
    process.exitCode = 2
    return
  }
  let pool
  try {
    const chunks = []
    let bytes = 0
    for await (const chunk of process.stdin) {
      bytes += chunk.length
      if (bytes > 16_384) throw new BootstrapError('invalid_input')
      chunks.push(chunk)
    }
    let input
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    catch { throw new BootstrapError('invalid_input') }
    validateBootstrapInput(input)
    pool = new Pool({ connectionString: process.env.HA05_BOOTSTRAP_DATABASE_URL,
      connectionTimeoutMillis: 5_000, statement_timeout: 5_000, idle_in_transaction_session_timeout: 10_000, max: 1 })
    console.log(JSON.stringify(await bootstrapCompany(pool, input)))
  } catch (error) {
    console.error(error instanceof BootstrapError ? error.message : new BootstrapError('bootstrap_unavailable').message)
    process.exitCode = 1
  } finally { await pool?.end().catch(() => {}) }
}
void main()
