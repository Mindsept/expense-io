/** Dormant administrator-only proposal. Never import into the web application. */
import bcrypt from 'bcryptjs'

const messages = {
  invalid_input: 'Check the explicit company and first-HR fields.',
  administrator_required: 'Use a dedicated administrator connection without SET ROLE.',
  bootstrap_conflict: 'Company or account already exists; no affiliation was changed.',
  bootstrap_unavailable: 'Company bootstrap could not be completed.',
}
export class BootstrapError extends Error {
  constructor(code) { super(messages[code]); this.code = code; this.name = 'BootstrapError' }
}
export function validateBootstrapInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some(key => !['companyName', 'companyDomain', 'name', 'email', 'password'].includes(key)) ||
    typeof input.companyName !== 'string' || !input.companyName.trim() || input.companyName.trim().length > 200 ||
    typeof input.companyDomain !== 'string' || input.companyDomain.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(input.companyDomain) ||
    typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 200 ||
    typeof input.email !== 'string' || input.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ||
    typeof input.password !== 'string' || input.password.length < 8 || Buffer.byteLength(input.password, 'utf8') > 72) {
    throw new BootstrapError('invalid_input')
  }
}

/** Explicitly supplied company and first HR, not an email-domain affiliation rule.
 * Administration is outside the web process. Existing companies/accounts are never adopted.
 * No automatic sign-in, email delivery, schema changes or runtime privilege grants.
 */
export async function bootstrapCompany(pool, input, { schemaName = 'public' } = {}) {
  validateBootstrapInput(input)
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schemaName)) throw new BootstrapError('invalid_input')
  const target = `"${schemaName}"`
  let passwordHash
  try { passwordHash = await bcrypt.hash(input.password, 12) }
  catch { throw new BootstrapError('bootstrap_unavailable') }
  let client
  let transaction = false
  try {
    client = await pool.connect()
    const { rows: [role] } = await client.query(`
      SELECT (c.rolsuper OR c.rolbypassrls) AND (s.rolsuper OR s.rolbypassrls)
        AND current_user = session_user AS permitted
      FROM pg_catalog.pg_roles c CROSS JOIN pg_catalog.pg_roles s
      WHERE c.rolname = current_user AND s.rolname = session_user
    `)
    if (!role?.permitted) throw new BootstrapError('administrator_required')
    await client.query('BEGIN'); transaction = true
    const company = await client.query(
      `INSERT INTO ${target}.companies (name,email_domain) VALUES ($1,$2) RETURNING id`,
      [input.companyName.trim(), input.companyDomain],
    )
    const companyId = company.rows[0].id
    const firstHr = await client.query(
      `INSERT INTO ${target}.users (company_id,name,email,password_hash,role,is_active)
       VALUES ($1,$2,$3,$4,'hr_admin',true) RETURNING id`,
      [companyId, input.name.trim(), input.email, passwordHash],
    )
    await client.query('COMMIT'); transaction = false
    return { kind: 'company_bootstrapped', companyId, firstHrId: firstHr.rows[0].id, next: 'sign_in' }
  } catch (error) {
    if (transaction) {
      try { await client.query('ROLLBACK') }
      catch { client.release(true); client = undefined }
    }
    if (error instanceof BootstrapError) throw error
    if (error?.code === '23505') throw new BootstrapError('bootstrap_conflict')
    throw new BootstrapError('bootstrap_unavailable')
  } finally { client?.release() }
}

