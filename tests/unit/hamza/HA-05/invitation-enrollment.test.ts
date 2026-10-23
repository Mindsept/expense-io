import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createInvitationToken, EnrollmentError, issueEmployeeInvitation, redeemInvitation, revokeEmployeeInvitation, type EnrollmentCommand } from '../../../../proposals/HA-05/invitation-enrollment'

function command(): EnrollmentCommand {
  return { token: createInvitationToken().token, verifiedEmail: 'person@example.test', name: 'Person', password: randomBytes(24).toString('base64url') }
}

describe('draft invitation capabilities', () => {
  it.each([{ email: 'invalid', ttlSeconds: 3600 }, { email: 'person@example.test', ttlSeconds: 59 }, { email: 'person@example.test', ttlSeconds: 604801 }])('rejects invalid issuer inputs before acquiring a connection: %j', async (input) => {
    const connect = vi.fn()
    await expect(issueEmployeeInvitation({ connect }, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', input)).rejects.toMatchObject({ code: 'invalid_input' })
    expect(connect).not.toHaveBeenCalled()
  })
  it('creates independent 256-bit canonical tokens and only their SHA-256 storage value', () => {
    const first = createInvitationToken()
    const second = createInvitationToken()
    expect(Buffer.from(first.token, 'base64url').length).toBe(32)
    expect(first.token.length).toBe(43)
    expect(first.token === second.token).toBe(false)
    expect(first.tokenSha256 === createHash('sha256').update(first.token).digest('hex')).toBe(true)
    expect(first.tokenSha256.includes(first.token)).toBe(false)
    expect(first.tokenSha256.length).toBe(64)
  })

  it.each([
    { name: '' }, { name: ' '.repeat(8) }, { name: 'x'.repeat(201) },
    { verifiedEmail: 'not-an-email' }, { verifiedEmail: 'person@example.test\n' },
    { password: 'short' }, { password: 'é'.repeat(37) },
  ])('rejects malformed fields before acquiring a database connection (case %#)', async (patch) => {
    const connect = vi.fn(async () => { throw new Error('must not acquire') })
    await expect(redeemInvitation({ connect }, { ...command(), ...patch })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(connect).not.toHaveBeenCalled()
  })

  it.each(['', 'forged', 'a'.repeat(44), 'a'.repeat(42) + '!'])('rejects malformed token before acquiring a database connection (case %#)', async (token) => {
    const connect = vi.fn(async () => { throw new Error('must not acquire') })
    await expect(redeemInvitation({ connect }, { ...command(), token })).rejects.toMatchObject({ code: 'invitation_unavailable' })
    expect(connect).not.toHaveBeenCalled()
  })

  it('bounds technical failures without exposing connection credentials or inputs', async () => {
    const input = command()
    const connect = vi.fn(async () => { throw new Error(`postgres://private:private@db/private ${input.password} ${input.token}`) })
    try {
      await redeemInvitation({ connect }, input)
      throw new Error('expected enrollment to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(EnrollmentError)
      expect((error as EnrollmentError).code).toBe('enrollment_unavailable')
      const message = (error as Error).message
      expect(message.includes(input.password) || message.includes(input.token) || message.includes('postgres://')).toBe(false)
    }
    expect(connect).toHaveBeenCalledOnce()
  })
})


describe('draft invitation revocation boundary', () => {
  it('rejects invalid invitation IDs before acquiring a connection', async () => {
    const connect = vi.fn()
    await expect(revokeEmployeeInvitation({ connect },'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','invalid')).rejects.toMatchObject({ code:'invitation_unavailable' })
    expect(connect).not.toHaveBeenCalled()
  })
})
