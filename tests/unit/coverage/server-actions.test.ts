import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('next-auth', () => ({ AuthError: class AuthError extends Error {} }))
const io = vi.hoisted(() => ({ auth: vi.fn(), issue: vi.fn(), revoke: vi.fn(), deliver: vi.fn(), settings: vi.fn(), actor: vi.fn(), readDecision: vi.fn(), readAssignment: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), redeem: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: io.auth, signIn: io.signIn, signOut: io.signOut }))
vi.mock('@/lib/db', () => ({ getPool: () => ({}) }))
vi.mock('@/lib/enrollment/runtime', async original => ({ ...await original<typeof import('@/lib/enrollment/runtime')>(), issueEmployeeInvitation: io.issue, revokeEmployeeInvitation: io.revoke, redeemInvitation: io.redeem }))
vi.mock('@/lib/enrollment/delivery', () => ({ deliverInvitation: io.deliver, readInvitationDelivery: io.settings }))
vi.mock('@/lib/current-actor', () => ({ withCurrentActor: io.actor }))
vi.mock('@/lib/notifications/inbox', () => ({ markDecisionInboxRead: io.readDecision, markAssignmentRead: io.readAssignment }))
import { inviteEmployee, revokeInvitation } from '@/app/actions/invitations'
import { markNotificationRead } from '@/app/actions/notifications'
import { login, logout, signup } from '@/app/actions/auth'
import { EnrollmentError } from '@/lib/enrollment/runtime'
function form(values: Record<string, string>) { const f = new FormData(); Object.entries(values).forEach(([k, v]) => f.set(k, v)); return f }
beforeEach(() => {
  vi.resetAllMocks(); io.auth.mockResolvedValue({ user: { id: 'server-actor', role: 'hr_admin' } })
  io.settings.mockReturnValue({ ttlSeconds: 172800 }); io.issue.mockResolvedValue({ invitationId: 'issued-id', token: 'private-token' })
  io.actor.mockImplementation(async (_role, work) => work({}, { id: 'server-actor' }))
})
describe('invitation actions', () => {
  it('issues and delivers an invitation without returning its private capabilities', async () => {
    const result = await inviteEmployee({}, form({ email: 'alice@example.test' }))
    expect(result.success).toContain('service d’envoi'); expect(JSON.stringify(result)).not.toContain('private-token')
    expect(io.issue).toHaveBeenCalledWith({}, 'server-actor', { email: 'alice@example.test', ttlSeconds: 172800 })
    expect(io.deliver).toHaveBeenCalledExactlyOnceWith({ invitationId: 'issued-id', token: 'private-token' }, { ttlSeconds: 172800 })
    expect(io.revoke).not.toHaveBeenCalled()
  })
  it.each([inviteEmployee, revokeInvitation])('requires a session and valid form field', async action => {
    io.auth.mockResolvedValueOnce(null); expect((await action({}, form({}))).error).toContain('Connectez-vous')
    expect((await action({}, form({}))).error).toMatch(/invalide|indisponible/)
    expect(io.issue).not.toHaveBeenCalled(); expect(io.revoke).not.toHaveBeenCalled()
  })
  it.each(['settings', 'issue', 'delivery', 'revocation'])('bounds %s errors and revokes uncertain deliveries', async fault => {
    if (fault === 'settings') io.settings.mockImplementation(() => { throw new Error('private') })
    if (fault === 'issue') io.issue.mockRejectedValue(new Error('private'))
    if (fault === 'delivery' || fault === 'revocation') io.deliver.mockRejectedValue(new Error('timeout'))
    if (fault === 'revocation') io.revoke.mockRejectedValue(new Error('private'))
    expect((await inviteEmployee({}, form({ email: 'alice@example.test' }))).error).toContain('Invitation non confirmée')
    expect(io.revoke).toHaveBeenCalledTimes(['delivery', 'revocation'].includes(fault) ? 1 : 0)
  })
  it('reports successful and refused revocation', async () => {
    expect(await revokeInvitation({}, form({ invitationId: 'id' }))).toEqual({ success: 'Invitation révoquée.' })
    io.revoke.mockRejectedValue(new Error('private'))
    expect((await revokeInvitation({}, form({ invitationId: 'id' }))).error).toContain('droits insuffisants')
  })
})
it.each(['decision', 'assignment'])('marks a current %s notification as read and handles unavailable results', async kind => {
  const action = kind === 'decision' ? io.readDecision : io.readAssignment
  action.mockResolvedValueOnce({ readAt: '2026-10-26T12:00:00Z' }).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('private'))
  const input = form({ eventId: 'id', kind })
  expect(await markNotificationRead({}, input)).toEqual({ readAt: '2026-10-26T12:00:00Z' })
  expect((await markNotificationRead({}, input)).error).toContain('droits actuels')
  expect((await markNotificationRead({}, input)).error).toContain('Réessayez plus tard')
})
it('rejects malformed mark-read input without querying the actor', async () => {
  expect(await markNotificationRead({}, form({}))).toEqual({ error: 'Notification indisponible.' }); expect(io.actor).not.toHaveBeenCalled()
})
it('logs in with validated fields and logs out to the sign-in page', async () => {
  expect(await login({}, form({}))).toEqual({ error: 'Champs invalides.' })
  expect(await login({}, form({ email: 'a@example.test', password: 'test' }))).toEqual({})
  expect(io.signIn).toHaveBeenCalledExactlyOnceWith('credentials', { email: 'a@example.test', password: 'test', redirectTo: '/expenses' })
  await logout(); expect(io.signOut).toHaveBeenCalledWith({ redirectTo: '/login' })
})
it.each(['account_exists', 'invalid_input', 'invitation_unavailable', 'enrollment_unavailable'] as const)('explains enrollment failure %s without leaking the input', async code => {
  io.redeem.mockRejectedValue(new EnrollmentError(code))
  const result = await signup({}, form({ invitation: 'private-token', emailProof: 'private-proof', name: 'Alice', password: 'private-password' }))
  expect(result.error).toMatch(code === 'account_exists' ? /existe déjà/ : code === 'invalid_input' ? /Nom requis/ : code === 'invitation_unavailable' ? /Invitation invalide/ : /non confirmée/)
  expect(JSON.stringify(result)).not.toContain('private-')
})
