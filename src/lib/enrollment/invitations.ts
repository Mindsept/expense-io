import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { Pool } from 'pg'

export type EnrollmentFailure = 'invalid_input' | 'invitation_unavailable' | 'account_exists' | 'enrollment_unavailable' | 'issuer_forbidden'

const messages: Record<EnrollmentFailure, string> = {
  invalid_input: 'Check the enrollment fields.',
  invitation_unavailable: 'The invitation cannot be used.',
  account_exists: 'An account already exists. Sign in instead.',
  enrollment_unavailable: 'Enrollment could not be completed. Try again later.',
  issuer_forbidden: 'The current account cannot issue this invitation.',
}

export class EnrollmentError extends Error {
  constructor(readonly code: EnrollmentFailure) {
    super(messages[code])
    this.name = 'EnrollmentError'
  }
}

/** Return to the authorized issuing process once; never log or list `token`. */
export function createInvitationToken(): { token: string; tokenSha256: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenSha256: digestToken(token) }
}

/** Authorized invitation issuer. actorId must come from server authentication.
 * The caller supplies an explicit reviewed TTL; no default product duration is chosen.
 * The returned capability is private input for a future controlled delivery adapter.
 */
export async function issueEmployeeInvitation(
  pool: Pick<Pool, 'connect'>, actorId: string, input: { email: string; ttlSeconds: number },
) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(actorId)) throw new EnrollmentError('issuer_forbidden')
  if (typeof input.email !== 'string' || input.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ||
    !Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds < 60 || input.ttlSeconds > 604800) throw new EnrollmentError('invalid_input')
  const capability = createInvitationToken()
  const proof = createInvitationToken()
  let client
  try { client = await pool.connect() } catch { throw new EnrollmentError('enrollment_unavailable') }
  let transaction = false
  try {
    await client.query('BEGIN'); transaction = true
    const actor = await client.query<{ id: string; company_id: string }>(
      "SELECT id, company_id FROM users WHERE id=$1 AND role='hr_admin' AND is_active FOR SHARE", [actorId],
    )
    const current = actor.rows[0]
    if (!current) throw new EnrollmentError('issuer_forbidden')
    const result = await client.query<{ id: string; expires_at: Date }>(
      `INSERT INTO enrollment_invitations (token_sha256, company_id, issued_by, intended_email, invited_role, expires_at, proof_sha256)
       VALUES ($1,$2,$3,$4,'employee',clock_timestamp() + $5::int * interval '1 second',$6) RETURNING id, expires_at`,
      [capability.tokenSha256, current.company_id, current.id, input.email, input.ttlSeconds, proof.tokenSha256],
    )
    await client.query('COMMIT'); transaction = false
    return { invitationId: result.rows[0].id, companyId: current.company_id, token: capability.token,
      proofToken: proof.token, intendedEmail: input.email, expiresAt: result.rows[0].expires_at.toISOString() }
  } catch (error) {
    if (transaction) {
      try { await client.query('ROLLBACK') } catch { client.release(true); client = undefined }
    }
    if (error instanceof EnrollmentError) throw error
    throw new EnrollmentError('enrollment_unavailable')
  } finally { client?.release() }
}

/** HR revocation capability. Both IDs come from the future authorized
 * server command; current role/company are reloaded, never supplied by a client.
 * Repeated revocation preserves its first server timestamp. Consumed invitations
 * cannot be revoked or used to alter an existing account.
 */
export async function revokeEmployeeInvitation(pool: Pick<Pool, 'connect'>, actorId: string, invitationId: string) {
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
  if (!uuid.test(actorId)) throw new EnrollmentError('issuer_forbidden')
  if (!uuid.test(invitationId)) throw new EnrollmentError('invitation_unavailable')
  let client
  try { client = await pool.connect() } catch { throw new EnrollmentError('enrollment_unavailable') }
  let transaction = false
  try {
    await client.query('BEGIN'); transaction = true
    const actor = await client.query<{ company_id: string }>(
      "SELECT company_id FROM users WHERE id=$1 AND role='hr_admin' AND is_active FOR SHARE", [actorId],
    )
    if (!actor.rows[0]) throw new EnrollmentError('issuer_forbidden')
    const result = await client.query<{ id: string; revoked_at: Date }>(
      `UPDATE enrollment_invitations SET revoked_at=coalesce(revoked_at,clock_timestamp())
       WHERE id=$1 AND company_id=$2 AND consumed_at IS NULL RETURNING id,revoked_at`,
      [invitationId, actor.rows[0].company_id],
    )
    if (!result.rows[0]) throw new EnrollmentError('invitation_unavailable')
    await client.query('COMMIT'); transaction = false
    return { invitationId: result.rows[0].id, revokedAt: result.rows[0].revoked_at.toISOString() }
  } catch (error) {
    if (transaction) {
      try { await client.query('ROLLBACK') } catch { client.release(true); client = undefined }
    }
    if (error instanceof EnrollmentError) throw error
    throw new EnrollmentError('enrollment_unavailable')
  } finally { client?.release() }
}

function digestToken(token: string): string {
  // Canonical encoding prevents alternate spellings of the same random bytes.
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || Buffer.from(token, 'base64url').toString('base64url') !== token) {
    throw new EnrollmentError('invitation_unavailable')
  }
  return createHash('sha256').update(token).digest('hex')
}

/** Internal command, NOT an HTTP/form DTO. No client company or role is read. */
export type EnrollmentCommand = {
  token: string
  /** Must come from a trusted identity-proof adapter, NEVER a self-declared form field.
   * This draft does not implement that adapter or claim proof of affiliation. */
  verifiedEmail?: string
  /** Independent capability delivered exclusively to the invitation address. */
  emailProof?: string
  name: string
  password: string
}

export type CreatedAccount = {
  kind: 'account_created'
  /** Internal sign-in input; never returned by the public server action. */
  email: string
  userId: string
  companyId: string
  next: 'sign_in'
}

function validate(command: EnrollmentCommand): string {
  if (
    (command.emailProof === undefined && (typeof command.verifiedEmail !== 'string' || command.verifiedEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(command.verifiedEmail))) ||
    typeof command.name !== 'string' || !command.name.trim() || command.name.trim().length > 200 ||
    typeof command.password !== 'string' || command.password.length < 8 ||
    Buffer.byteLength(command.password, 'utf8') > 72
  ) throw new EnrollmentError('invalid_input')
  if (command.emailProof !== undefined) digestToken(command.emailProof)
  if (typeof command.token !== 'string') throw new EnrollmentError('invitation_unavailable')
  return digestToken(command.token)
}

/**
 * No default pool, environment lookup, administrator credential, email sending
 * or automatic login. Caller must inject the approved narrow DB capability.
 * Password hashing occurs before obtaining a connection or holding a row lock.
 * A successful result means the account committed; login is a separate action.
 */
export async function redeemInvitation(pool: Pick<Pool, 'connect'>, command: EnrollmentCommand): Promise<CreatedAccount> {
  const tokenSha256 = validate(command)
  let passwordHash: string
  try {
    passwordHash = await bcrypt.hash(command.password, 12)
  } catch {
    throw new EnrollmentError('enrollment_unavailable')
  }
  let client
  try {
    client = await pool.connect()
  } catch {
    throw new EnrollmentError('enrollment_unavailable')
  }
  let transaction = false
  try {
    await client.query('BEGIN')
    transaction = true
    const invitation = await client.query<{
      id: string; company_id: string; intended_email: string; invited_role: 'employee'
      revoked_at: Date | null; consumed_at: Date | null; unexpired: boolean; proof_sha256: string | null
    }>(
      `SELECT id, company_id, intended_email, invited_role, revoked_at, consumed_at, proof_sha256,
              expires_at > clock_timestamp() AS unexpired
       FROM enrollment_invitations WHERE token_sha256 = $1 FOR UPDATE`,
      [tokenSha256],
    )
    const row = invitation.rows[0]
    const identityMatches = row && (command.emailProof !== undefined
      ? row.proof_sha256 === digestToken(command.emailProof)
      : row.intended_email === command.verifiedEmail)
    if (!row || !identityMatches || row.revoked_at || row.consumed_at || !row.unexpired) {
      throw new EnrollmentError('invitation_unavailable')
    }
    // Company and role come only from the locked invitation. Existing email
    // uniqueness rejects reuse; no update/upsert can reassign an existing user.
    const created = await client.query<{ id: string }>(
      `INSERT INTO users (company_id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [row.company_id, command.name.trim(), row.intended_email, passwordHash, row.invited_role],
    )
    const userId = created.rows[0].id
    // Recheck expiry against the DB clock after any lock wait/INSERT delay.
    const consumed = await client.query(
      `UPDATE enrollment_invitations SET consumed_at = clock_timestamp(), consumed_by = $2
       WHERE id = $1 AND consumed_at IS NULL AND revoked_at IS NULL
         AND expires_at > clock_timestamp() RETURNING id`,
      [row.id, userId],
    )
    if (consumed.rowCount !== 1) throw new EnrollmentError('invitation_unavailable')
    await client.query('COMMIT')
    transaction = false
    return { kind: 'account_created', email: row.intended_email, userId, companyId: row.company_id, next: 'sign_in' }
  } catch (error) {
    if (transaction) {
      try { await client.query('ROLLBACK') } catch {
        // Never return a potentially still-transactional connection to the pool.
        client.release(true)
        client = undefined
      }
    }
    if (error instanceof EnrollmentError) throw error
    if (
      typeof error === 'object' && error !== null &&
      'code' in error && error.code === '23505' &&
      'constraint' in error && error.constraint === 'users_email_key'
    ) throw new EnrollmentError('account_exists')
    // Raw SQL errors may contain values. Keep them out of the public contract.
    throw new EnrollmentError('enrollment_unavailable')
  } finally {
    client?.release()
  }
}
