import bcrypt from 'bcryptjs'
import type { Pool, PoolClient } from 'pg'
import { createHash } from 'node:crypto'
import { createInvitationToken, EnrollmentError, type EnrollmentFailure, type CreatedAccount } from './invitations'
export { EnrollmentError } from './invitations'

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
function digest(value: string) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value) || Buffer.from(value,'base64url').toString('base64url') !== value) throw new EnrollmentError('invitation_unavailable')
  return createHash('sha256').update(value).digest('hex')
}
async function command<T extends {error_code: EnrollmentFailure | null}>(pool: Pick<Pool,'connect'>, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient | undefined, transaction = false, discard = false
  try {
    client = await pool.connect()
    await client.query('BEGIN'); transaction = true
    const row = await operation(client)
    if (!row) throw new EnrollmentError('enrollment_unavailable')
    if (row.error_code) throw new EnrollmentError(row.error_code)
    await client.query('COMMIT'); transaction = false
    return row
  } catch (error) {
    if (transaction && client) { try { await client.query('ROLLBACK') } catch { discard = true } }
    if (error instanceof EnrollmentError) throw error
    throw new EnrollmentError('enrollment_unavailable')
  } finally { client?.release(discard) }
}
export async function issueEmployeeInvitation(pool: Pick<Pool,'connect'>, actorId: string, input: {email:string;ttlSeconds:number}) {
  if (!uuid.test(actorId)) throw new EnrollmentError('issuer_forbidden')
  if (typeof input.email !== 'string' || input.email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || !Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds<60 || input.ttlSeconds>604800) throw new EnrollmentError('invalid_input')
  const invite = createInvitationToken(), proof = createInvitationToken()
  const saved = await command(pool,async client => (await client.query<{invitation_id:string;company_id:string;expires_at:Date;error_code:EnrollmentFailure|null}>(
    'SELECT * FROM expense_auth.issue_invitation($1::uuid,$2::text,$3::int,$4::text,$5::text)',[actorId,input.email,input.ttlSeconds,invite.tokenSha256,proof.tokenSha256],
  )).rows[0])
  return {invitationId:saved.invitation_id,companyId:saved.company_id,expiresAt:saved.expires_at.toISOString(),intendedEmail:input.email,token:invite.token,proofToken:proof.token}
}
export async function revokeEmployeeInvitation(pool: Pick<Pool,'connect'>, actorId:string, invitationId:string) {
  if (!uuid.test(actorId)) throw new EnrollmentError('issuer_forbidden')
  if (!uuid.test(invitationId)) throw new EnrollmentError('invitation_unavailable')
  const saved = await command(pool,async client => (await client.query<{id:string;revoked_at:Date;error_code:EnrollmentFailure|null}>(
    'SELECT * FROM expense_auth.revoke_invitation($1::uuid,$2::uuid)',[actorId,invitationId],
  )).rows[0])
  return {invitationId:saved.id,revokedAt:saved.revoked_at.toISOString()}
}
export async function redeemInvitation(pool: Pick<Pool,'connect'>, input:{token:string;emailProof:string;name:string;password:string}):Promise<CreatedAccount> {
  const invite = digest(input.token), proof = digest(input.emailProof)
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length>200 || typeof input.password !== 'string' || input.password.length<8 || Buffer.byteLength(input.password,'utf8')>72) throw new EnrollmentError('invalid_input')
  let hash: string
  try { hash = await bcrypt.hash(input.password,12) } catch { throw new EnrollmentError('enrollment_unavailable') }
  const saved = await command(pool,async client => (await client.query<{user_id:string;company_id:string;email:string;error_code:EnrollmentFailure|null}>(
    'SELECT * FROM expense_auth.redeem_invitation($1::text,$2::text,$3::text,$4::text)',[invite,proof,input.name.trim(),hash],
  )).rows[0])
  return {kind:'account_created',userId:saved.user_id,companyId:saved.company_id,email:saved.email,next:'sign_in'}
}
