// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import userEvent from '@testing-library/user-event'
import Home from '@/app/page'
import HrPage from '@/app/hr/page'
import ManagerPage from '@/app/manager/page'
import RootLayout from '@/app/layout'
import NotificationsPage from '@/app/notifications/page'
import InvitationsPage from '@/app/hr/invitations/page'
import SignupPage from '@/app/signup/page'
import LoginPage from '@/app/login/page'
import { InviteEmployeeForm, RevokeInvitationForm } from '@/components/enrollment/InvitationForms'
import { ReadNotification } from '@/components/notifications/ReadNotification'
import { deferred } from './ui-helpers'
const io = vi.hoisted(() => ({ auth: vi.fn(), pathname: vi.fn(), login: vi.fn(), signup: vi.fn(), invite: vi.fn(), revoke: vi.fn(), mark: vi.fn(), actor: vi.fn(), query: vi.fn(), inbox: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: io.auth }))
vi.mock('next/font/google', () => ({ Geist: () => ({ variable: 'sans' }), Geist_Mono: () => ({ variable: 'mono' }) }))
vi.mock('next/navigation', () => ({ usePathname: io.pathname, redirect: (url: string) => { throw new Error(`redirect:${url}`) } }))
vi.mock('@/app/actions/auth', () => ({ login: io.login, signup: io.signup, logout: async () => {} }))
vi.mock('@/app/actions/invitations', () => ({ inviteEmployee: io.invite, revokeInvitation: io.revoke }))
vi.mock('@/app/actions/notifications', () => ({ markNotificationRead: io.mark }))
vi.mock('@/lib/current-actor', () => ({ withCurrentActor: io.actor }))
vi.mock('@/lib/notifications/inbox', () => ({ notificationInbox: io.inbox }))
beforeEach(() => {
  vi.resetAllMocks(); io.pathname.mockReturnValue('/notifications'); io.auth.mockResolvedValue(null)
  io.actor.mockImplementation(async (_role, work) => work({ query: io.query }, { id: 'actor', companyId: 'company' }))
  io.query.mockResolvedValue({ rows: [] }); io.inbox.mockResolvedValue([])
  window.history.replaceState(null, '', '/')
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('offers login to anonymous visitors and redirects an authenticated home', async () => {
  expect(renderToStaticMarkup(await Home())).toContain('href="/login"')
  io.auth.mockResolvedValue({ user: {} }); await expect(Home()).rejects.toThrow('redirect:/expenses')
})
it.each(['employee', 'manager', 'hr_admin'])('renders only the allowed navigation and consoles for %s', async role => {
  io.auth.mockResolvedValue({ user: { role, email: 'a@example.test' } }); io.pathname.mockReturnValue(role === 'manager' ? '/manager' : '/hr/invitations')
  const layout = renderToStaticMarkup(await RootLayout({ children: <p>Content</p> }))
  expect(layout).toContain('Content'); expect(layout).toContain('Se déconnecter')
  expect(layout.includes('href="/hr"')).toBe(role === 'hr_admin'); expect(layout.includes('href="/manager"')).toBe(role === 'manager')
  expect(renderToStaticMarkup(await HrPage())).toContain(role === 'hr_admin' ? 'Gérer les invitations' : 'Accès réservé aux RH')
  expect(renderToStaticMarkup(await ManagerPage())).toContain(role === 'manager' ? 'Validation des notes de frais' : 'Accès réservé aux managers')
})
it('renders the anonymous layout without authenticated navigation', async () => { expect(renderToStaticMarkup(await RootLayout({ children: 'Home' }))).not.toContain('Se déconnecter') })
it('protects inbox access and distinguishes notification types and decision outcomes', async () => {
  await expect(NotificationsPage()).rejects.toThrow('redirect:/login')
  io.auth.mockResolvedValue({ user: {} }); expect(renderToStaticMarkup(await NotificationsPage())).toContain('Aucune notification')
  io.inbox.mockResolvedValue([
    ...['pending', 'approved', 'rejected'].map((expenseStatus, i) => ({ eventId: String(i), kind: 'assignment', expenseStatus, href: '/manager', createdAt: '2026-10-20T12:00:00Z', readAt: null })),
    ...['approved', 'rejected'].map((decision, i) => ({ eventId: String(i + 3), kind: 'decision', decision, href: '/expenses', createdAt: '2026-10-20T12:00:00Z', readAt: '2026-10-20T12:00:00Z' })),
  ])
  const html = renderToStaticMarkup(await NotificationsPage())
  for (const message of ['attend votre validation', 'déjà été acceptée', 'déjà été refusée', 'Votre note a été acceptée', 'Votre note a été refusée']) expect(html).toContain(message)
})
it('shows invitation status without revealing capabilities and offers revocation only when usable', async () => {
  expect(renderToStaticMarkup(await InvitationsPage())).toContain('Accès réservé aux RH')
  io.auth.mockResolvedValue({ user: { role: 'hr_admin' } })
  const date = new Date('2026-10-20T12:00:00Z')
  io.query.mockResolvedValue({ rows: [
    { id: 'pending', intended_email: 'pending@example.test', expires_at: date, expired: false },
    { id: 'expired', intended_email: 'expired@example.test', expires_at: date, expired: true },
    { id: 'revoked', intended_email: 'revoked@example.test', expires_at: date, revoked_at: date },
    { id: 'consumed', intended_email: 'used@example.test', expires_at: date, consumed_at: date },
  ] })
  const html = renderToStaticMarkup(await InvitationsPage())
  for (const status of ['En attente', 'Expirée', 'Révoquée', 'Utilisée']) expect(html).toContain(status)
  expect((html.match(/>Révoquer</g) ?? [])).toHaveLength(1)
})
it.each(['', '#invalid'])('rejects an incomplete invitation fragment %s', async hash => {
  window.history.replaceState(null, '', '/signup' + hash)
  const user = userEvent.setup(); render(<SignupPage />)
  await user.click(screen.getByRole('button', { name: 'Ouvrir mon invitation' }))
  expect(screen.getByRole('alert').textContent).toContain('Lien d’invitation invalide'); expect(window.location.hash).toBe('')
})
it.each([true, false])('consumes a private invitation fragment and displays the enrollment result (success=%s)', async success => {
  window.history.replaceState(null, '', '/signup#' + 'a'.repeat(43) + '.' + 'b'.repeat(43))
  io.signup.mockResolvedValue(success ? { accountCreated: true } : { error: 'Invitation expirée.' })
  const user = userEvent.setup(); render(<SignupPage />); await user.click(screen.getByRole('button', { name: 'Ouvrir mon invitation' }))
  expect(window.location.hash).toBe('')
  await user.type(screen.getByLabelText('Nom'), 'Alice'); await user.type(screen.getByLabelText('Mot de passe'), 'password123')
  await user.click(screen.getByRole('button', { name: 'Créer mon compte' }))
  expect((await screen.findByRole(success ? 'status' : 'alert')).textContent).toContain(success ? 'Votre compte a été créé' : 'Invitation expirée')
  expect((io.signup.mock.calls[0][1] as FormData).get('invitation')).toBe('a'.repeat(43))
})
it('disables login while pending and shows the server error', async () => {
  const pending = deferred<{ error: string }>(); io.login.mockReturnValue(pending.promise)
  const user = userEvent.setup(); render(<LoginPage />)
  await user.type(screen.getByLabelText('Email'), 'a@example.test'); await user.type(screen.getByLabelText('Mot de passe'), 'bad')
  await user.click(screen.getByRole('button', { name: 'Se connecter' }))
  expect((screen.getByRole('button', { name: 'Connexion…' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => pending.resolve({ error: 'Email ou mot de passe incorrect.' }))
  expect(screen.getByRole('alert').textContent).toContain('incorrect')
})
it.each(['invite', 'revoke', 'read'])('shows pending, failure and success states for %s', async kind => {
  const action = kind === 'invite' ? io.invite : kind === 'revoke' ? io.revoke : io.mark
  const pending = deferred<{ error: string }>(); action.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(kind === 'read' ? { readAt: '2026-10-20T12:00:00Z' } : { success: 'Confirmé.' })
  const user = userEvent.setup()
  render(kind === 'invite' ? <InviteEmployeeForm /> : kind === 'revoke' ? <RevokeInvitationForm id="invitation" /> : <ReadNotification eventId="event" kind="decision" readAt={null} />)
  if (kind === 'invite') await user.type(screen.getByLabelText('Adresse email à inviter'), 'a@example.test')
  fireEvent.submit(screen.getByRole('button').closest('form')!)
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
  await act(async () => pending.resolve({ error: 'Réessayez.' })); expect(screen.getByRole('alert').textContent).toBe('Réessayez.')
  if (kind === 'invite') {
    await user.clear(screen.getByLabelText('Adresse email à inviter'))
    await user.type(screen.getByLabelText('Adresse email à inviter'), 'a@example.test')
  }
  await user.click(screen.getByRole('button'))
  if (kind === 'read') expect((await screen.findByRole('button', { name: 'Lue' }) as HTMLButtonElement).disabled).toBe(true)
  else { expect((await screen.findByRole('status')).textContent).toBe('Confirmé.'); if (kind === 'revoke') expect((screen.getByRole('button', { name: 'Révoquée' }) as HTMLButtonElement).disabled).toBe(true) }
  expect(action).toHaveBeenCalledTimes(2)
})
