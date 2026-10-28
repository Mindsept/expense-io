import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import bcrypt from 'bcryptjs'
import * as direct from '@/lib/enrollment/invitations'
import * as runtime from '@/lib/enrollment/runtime'
import { actor, database, eventId } from './database-helper'

vi.mock('bcryptjs', () => ({ default: { hash: vi.fn(async () => 'hashed-password') } }))
const date = new Date('2026-10-22T12:00:00Z')
const input = { email: 'alice@example.test', ttlSeconds: 172800 }
const token = Buffer.alloc(32, 1).toString('base64url'), proof = Buffer.alloc(32, 2).toString('base64url')
const command = { token, emailProof: proof, name: ' Alice ', password: 'Test-password-123' }
const invitation = { id: eventId, company_id: actor.companyId, intended_email: input.email, invited_role: 'employee', revoked_at: null, consumed_at: null, unexpired: true, proof_sha256: createHash('sha256').update(proof).digest('hex') }
beforeEach(() => vi.mocked(bcrypt.hash).mockResolvedValue('hashed-password' as never))
afterEach(() => vi.clearAllMocks())
describe.each([{ name: 'direct', api: direct }, { name: 'runtime', api: runtime }])('$name enrollment', ({ name, api }) => {
  function healthy(patch: Record<string, unknown> = {}) {
    return database(sql => {
      if (sql.includes('expense_auth.issue_invitation')) return { rows: [{ invitation_id: eventId, company_id: actor.companyId, expires_at: date, error_code: null, ...patch }] }
      if (sql.includes('expense_auth.revoke_invitation')) return { rows: [{ id: eventId, revoked_at: date, error_code: null, ...patch }] }
      if (sql.includes('expense_auth.redeem_invitation')) return { rows: [{ user_id: actor.id, company_id: actor.companyId, email: input.email, error_code: null, ...patch }] }
      if (sql.includes('FROM users WHERE')) return { rows: [{ id: actor.id, company_id: actor.companyId }] }
      if (sql.includes('INSERT INTO enrollment_invitations')) return { rows: [{ id: eventId, expires_at: date }] }
      if (sql.includes('FROM enrollment_invitations')) return { rows: [{ ...invitation, ...patch }] }
      if (sql.includes('INSERT INTO users')) return { rows: [{ id: actor.id }] }
      if (sql.includes('UPDATE enrollment_invitations')) return { rows: [{ id: eventId, revoked_at: date }], rowCount: 1 }
      return { rows: [] }
    })
  }
  it('issues independent capabilities while storing only their digests', async () => {
    const db = healthy(); const result = await api.issueEmployeeInvitation(db.pool, actor.id, input)
    expect(result).toMatchObject({ invitationId: eventId, companyId: actor.companyId, intendedEmail: input.email, expiresAt: date.toISOString() })
    expect(Buffer.from(result.token, 'base64url')).toHaveLength(32)
    expect(result.proofToken).not.toBe(result.token)
    expect(JSON.stringify(db.query.mock.calls)).not.toContain(result.token)
    expect(JSON.stringify(db.query.mock.calls)).toContain(createHash('sha256').update(result.token).digest('hex'))
    expect(db.release).toHaveBeenCalledOnce()
  })
  it('revokes an invitation and returns its server timestamp', async () => {
    const db = healthy()
    expect(await api.revokeEmployeeInvitation(db.pool, actor.id, eventId)).toEqual({ invitationId: eventId, revokedAt: date.toISOString() })
  })
  it('redeems an invitation for the company and email selected by the server', async () => {
    const db = healthy()
    expect(await api.redeemInvitation(db.pool, command)).toEqual({ kind: 'account_created', userId: actor.id, companyId: actor.companyId, email: input.email, next: 'sign_in' })
    expect(bcrypt.hash).toHaveBeenCalledWith(command.password, 12)
    expect(JSON.stringify(db.query.mock.calls)).not.toContain(command.password)
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('COMMIT')
  })
  it.each([{ email: 'invalid' }, { email: 'a'.repeat(255) }, { ttlSeconds: 59 }, { ttlSeconds: 604801 }, { ttlSeconds: 1.5 }])('rejects invalid issue input %j before connecting', async patch => {
    const db = healthy(); await expect(api.issueEmployeeInvitation(db.pool, actor.id, { ...input, ...patch })).rejects.toMatchObject({ code: 'invalid_input' }); expect(db.connect).not.toHaveBeenCalled()
  })
  it('rejects malformed actor and invitation identifiers', async () => {
    const db = healthy()
    await expect(api.issueEmployeeInvitation(db.pool, 'bad', input)).rejects.toMatchObject({ code: 'issuer_forbidden' })
    await expect(api.revokeEmployeeInvitation(db.pool, 'bad', eventId)).rejects.toMatchObject({ code: 'issuer_forbidden' })
    await expect(api.revokeEmployeeInvitation(db.pool, actor.id, 'bad')).rejects.toMatchObject({ code: 'invitation_unavailable' })
    expect(db.connect).not.toHaveBeenCalled()
  })
  it.each([{ name: '' }, { name: 'x'.repeat(201) }, { password: 'short' }, { password: 'é'.repeat(37) }, { token: 'invalid' }, { emailProof: 'invalid' }])('rejects malformed redemption %j', async patch => {
    const db = healthy(); await expect(api.redeemInvitation(db.pool, { ...command, ...patch })).rejects.toBeInstanceOf(direct.EnrollmentError); expect(db.connect).not.toHaveBeenCalled()
  })
  it('bounds password-hasher errors before database access', async () => {
    const db = healthy(); vi.mocked(bcrypt.hash).mockRejectedValueOnce(new Error('private') as never)
    await expect(api.redeemInvitation(db.pool, command)).rejects.toMatchObject({ code: 'enrollment_unavailable' }); expect(db.connect).not.toHaveBeenCalled()
  })
  it.each(['issue', 'revoke', 'redeem'])('bounds %s connection failures', async operation => {
    const db = healthy(); db.connect.mockRejectedValueOnce(new Error('postgres://secret'))
    const run = () => operation === 'issue' ? api.issueEmployeeInvitation(db.pool, actor.id, input) : operation === 'revoke' ? api.revokeEmployeeInvitation(db.pool, actor.id, eventId) : api.redeemInvitation(db.pool, command)
    await expect(run()).rejects.toMatchObject({ code: 'enrollment_unavailable', message: 'Enrollment could not be completed. Try again later.' })
  })
  it.each(['issue', 'revoke', 'redeem'])('discards a broken %s transaction', async operation => {
    const db = database(sql => { if (sql !== 'BEGIN') throw new Error('private'); return { rows: [] } })
    const run = () => operation === 'issue' ? api.issueEmployeeInvitation(db.pool, actor.id, input) : operation === 'revoke' ? api.revokeEmployeeInvitation(db.pool, actor.id, eventId) : api.redeemInvitation(db.pool, command)
    await expect(run()).rejects.toMatchObject({ code: 'enrollment_unavailable' })
    expect(db.release).toHaveBeenCalledExactlyOnceWith(true)
  })
  it('refuses an unavailable invitation and rolls back', async () => {
    const db = healthy(name === 'runtime' ? { error_code: 'invitation_unavailable' } : { unexpired: false })
    await expect(api.redeemInvitation(db.pool, command)).rejects.toMatchObject({ code: 'invitation_unavailable' })
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK')
  })
})
it.each([{ revoked_at: date }, { consumed_at: date }, { proof_sha256: 'wrong' }])('rejects a revoked, used or wrong-recipient capability (%j)', async patch => {
  const db = database(sql => ({ rows: sql.includes('FROM enrollment_invitations') ? [{ ...invitation, ...patch }] : [] }))
  await expect(direct.redeemInvitation(db.pool, command)).rejects.toMatchObject({ code: 'invitation_unavailable' })
  expect(db.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO users'))).toBe(false)
})
it('supports trusted verified email and translates duplicate accounts without revealing SQL', async () => {
  const db = database(sql => { if (sql.includes('INSERT INTO users')) throw { code: '23505', constraint: 'users_email_key', detail: 'private' }; return { rows: sql.includes('FROM enrollment_invitations') ? [invitation] : [] } })
  await expect(direct.redeemInvitation(db.pool, { ...command, emailProof: undefined, verifiedEmail: input.email })).rejects.toMatchObject({ code: 'account_exists' })
})
it('rolls back if the invitation expires while the account is being inserted', async () => {
  const db = database(sql => ({ rows: sql.includes('FROM enrollment_invitations') ? [invitation] : sql.includes('INSERT INTO users') ? [{ id: actor.id }] : [], rowCount: 0 }))
  await expect(direct.redeemInvitation(db.pool, command)).rejects.toMatchObject({ code: 'invitation_unavailable' })
  expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK')
})
it.each(['issue', 'revoke'])('rechecks the HR role for %s', async operation => {
  const db = database(() => ({ rows: [] }))
  await expect(operation === 'issue' ? direct.issueEmployeeInvitation(db.pool, actor.id, input) : direct.revokeEmployeeInvitation(db.pool, actor.id, eventId)).rejects.toMatchObject({ code: 'issuer_forbidden' })
})
it('rejects a revoke outside the actor company', async () => {
  const db = database(sql => ({ rows: sql.includes('FROM users') ? [{ company_id: actor.companyId }] : [] }))
  await expect(direct.revokeEmployeeInvitation(db.pool, actor.id, eventId)).rejects.toMatchObject({ code: 'invitation_unavailable' })
})
it('rejects a runtime command returning no row', async () => {
  const db = database(() => ({ rows: [] }))
  await expect(runtime.issueEmployeeInvitation(db.pool, actor.id, input)).rejects.toMatchObject({ code: 'enrollment_unavailable' })
})
