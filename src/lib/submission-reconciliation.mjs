const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const extensions = new Set(['.png', '.jpg', '.webp', '.pdf'])

/** @param {{companyId:string,limit?:number,minAgeMs?:number,maxDurationMs?:number}} input */
export function reconciliationOptions(input) {
  const { companyId, limit = 25, minAgeMs = 300_000, maxDurationMs = 30_000 } = input
  if (!uuid.test(companyId) || !Number.isInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isInteger(minAgeMs) || minAgeMs < 300_000 || minAgeMs > 30 * 86400_000 ||
      !Number.isInteger(maxDurationMs) || maxDurationMs < 1000 || maxDurationMs > 120_000) throw new Error('Invalid reconciliation options')
  return { companyId: companyId.toLowerCase(), limit, minAgeMs, maxDurationMs }
}

/** @param {import('pg').Pool} pool @param {ReturnType<typeof reconciliationOptions>} options */
async function candidates(pool, options) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN READ ONLY')
    await client.query("SET LOCAL statement_timeout = '3000ms'")
    const privilege = await client.query(`SELECT
      (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user) AND
      (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=session_user) AS allowed`)
    if (privilege.rows[0]?.allowed !== true) throw new Error('A separate privileged maintenance login is required')
    const result = await client.query(
      `SELECT a.id,a.operation_id,a.extension,a.receipt_key,
        EXISTS (SELECT 1 FROM expense_notes n WHERE n.receipt_key=a.receipt_key) AS referenced
       FROM expense_submission_attempts a JOIN expense_submission_operations o ON o.id=a.operation_id
       WHERE a.company_id=$1 AND o.company_id=$1 AND a.state<>'committed'
         AND a.created_at <= clock_timestamp()-($3::double precision * interval '1 millisecond')
         AND (a.state='retired' OR o.current_attempt_id IS DISTINCT FROM a.id
           OR (o.state='processing' AND o.lease_until <= clock_timestamp()))
       ORDER BY a.cleanup_checked_at NULLS FIRST,a.created_at,a.id LIMIT $2`,
      [options.companyId, options.limit, options.minAgeMs],
    )
    await client.query('COMMIT')
    return result.rows
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error }
  finally { client.release() }
}

function validReference(attempt) {
  return uuid.test(attempt.id) && extensions.has(attempt.extension) && attempt.receipt_key === `receipts/${attempt.id}${attempt.extension}`
}

/** Fence in a short transaction, before any storage deletion. */
async function fence(pool, options, candidate) {
  const client = await pool.connect()
  let committing = false
  try {
    await client.query('BEGIN')
    await client.query("SET LOCAL statement_timeout = '3000ms'")
    const operation = await client.query(
      `SELECT state,current_attempt_id,lease_until <= clock_timestamp() AS lease_expired
       FROM expense_submission_operations WHERE id=$1 AND company_id=$2 FOR UPDATE NOWAIT`,
      [candidate.operation_id, options.companyId],
    )
    const attempt = await client.query(
      `SELECT *,created_at <= clock_timestamp()-($3::double precision * interval '1 millisecond') AS old_enough
       FROM expense_submission_attempts WHERE id=$1 AND company_id=$2 FOR UPDATE NOWAIT`,
      [candidate.id, options.companyId, options.minAgeMs],
    )
    const op = operation.rows[0], row = attempt.rows[0]
    if (!op || !row || row.operation_id !== candidate.operation_id || !row.old_enough || row.state === 'committed' ||
        (op.state === 'completed' && op.current_attempt_id === row.id) ||
        (op.current_attempt_id === row.id && op.state === 'processing' && !op.lease_expired)) {
      await client.query('ROLLBACK'); return 'skipped'
    }
    if (!validReference(row)) { await client.query('ROLLBACK'); return 'invalid_reference' }
    const referenced = await client.query('SELECT 1 FROM expense_notes WHERE receipt_key=$1 LIMIT 1', [row.receipt_key])
    if (referenced.rows.length) {
      await client.query(`UPDATE expense_submission_attempts SET cleanup_checked_at=clock_timestamp(),cleanup_result='referenced' WHERE id=$1 AND company_id=$2`, [row.id, options.companyId])
      committing = true; await client.query('COMMIT'); return 'referenced'
    }
    if (op.current_attempt_id === row.id) await client.query(
      `UPDATE expense_submission_operations SET state='failed',current_attempt_id=NULL,
        lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1 AND company_id=$2`, [candidate.operation_id, options.companyId],
    )
    await client.query(`UPDATE expense_submission_attempts SET state='retired',updated_at=clock_timestamp() WHERE id=$1 AND company_id=$2`, [row.id, options.companyId])
    committing = true
    await client.query('COMMIT')
    return 'delete'
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    return error?.code === '55P03' ? 'busy' : committing ? 'state_unknown' : 'database_error'
  } finally { client.release() }
}

async function stamp(pool, options, row, result) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SET LOCAL statement_timeout = '3000ms'")
    await client.query(
      `UPDATE expense_submission_attempts SET cleanup_checked_at=clock_timestamp(),cleanup_result=$3
       WHERE id=$1 AND company_id=$2 AND state='retired'`, [row.id, options.companyId, result],
    )
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error }
  finally { client.release() }
}

/**
 * No bucket inventory or public endpoint. The caller supplies an explicit private
 * maintenance connection and company scope; application credentials are refused.
 * @param {{pool:import('pg').Pool,companyId:string,apply?:boolean,limit?:number,minAgeMs?:number,maxDurationMs?:number,removeReceipt:(key:string,timeoutMs:number)=>Promise<void>}} input
 */
export async function reconcileSubmissions(input) {
  const options = reconciliationOptions(input)
  const started = performance.now()
  const rows = await candidates(input.pool, options)
  const items = []
  for (const row of rows) {
    const remaining = options.maxDurationMs - (performance.now() - started)
    if (remaining <= 0) break
    const item = { receiptRef: row.id, extension: extensions.has(row.extension) ? row.extension : undefined, status: '' }
    if (!validReference(row)) item.status = 'invalid_reference'
    else if (!input.apply) item.status = row.referenced ? 'referenced' : 'would_delete'
    else {
      item.status = await fence(input.pool, options, row)
      if (item.status === 'delete') {
        try {
          await input.removeReceipt(row.receipt_key, Math.max(1, Math.min(5000, Math.floor(options.maxDurationMs - (performance.now() - started)))))
          item.status = 'deleted'
        } catch { item.status = 'cleanup_failed' }
        try {
          await stamp(input.pool, options, row, item.status === 'deleted' ? 'deleted' : 'failed')
        } catch { item.status = 'state_unknown' }
      }
    }
    items.push(item)
  }
  return { mode: input.apply ? 'apply' : 'dry-run', scanned: rows.length, processed: items.length, budgetExhausted: items.length < rows.length, items }
}
