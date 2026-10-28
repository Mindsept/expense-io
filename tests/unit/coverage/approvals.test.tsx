// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PendingApprovalsPanel } from '@/components/PendingApprovalsPanel'
import { AdminConsole } from '@/components/AdminConsole'
import { mockFetch, note, page, response } from './ui-helpers'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe.each([
  { role: 'manager', Component: PendingApprovalsPanel, heading: /^En attente/, retry: 'Réessayer' },
  { role: 'hr', Component: AdminConsole, heading: /^Notes à valider/, retry: 'Réessayer les notes' },
])('$role approvals', ({ role, Component, heading, retry }) => {
  function serve(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
    return mockFetch((url, init) => url.startsWith('/api/hr/users') ? response(page([], 1, 0, false)) : handler(url, init))
  }
  it.each(['approve', 'reject'])('confirms %s, refreshes the list and moves focus to its heading', async (decision) => {
    let decided = false
    serve((url, init) => {
      if (init?.method === 'POST') { expect(url).toBe(`/api/${role}/expense-notes/note-1/${decision}`); decided = true; return response({ ok: true }) }
      return response(page(decided ? [] : [note]))
    })
    const user = userEvent.setup(); render(<Component />)
    expect((await screen.findByText('Taxi client')).textContent).toBe('Taxi client')
    expect(screen.getByText(/Total des notes en attente/).textContent).toContain('375')
    await user.click(screen.getByRole('button', { name: decision === 'approve' ? /^Approuver/ : /^Rejeter/ }))
    expect((await screen.findByText(decision === 'approve' ? 'Note de frais approuvée.' : 'Note de frais rejetée.')).textContent).toContain('Note de frais')
    await waitFor(() => expect(screen.queryByText('Taxi client')).toBeNull())
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: heading }))
  })
  it.each([409, 403, 'network'])('keeps the note visible after a %s decision failure', async (failure) => {
    serve((_url, init) => { if (init?.method === 'POST') { if (failure === 'network') throw new TypeError('offline'); return response({ error: 'Forbidden' }, Number(failure)) } return response(page()) })
    const user = userEvent.setup(); render(<Component />); await screen.findByText('Taxi client')
    await user.click(screen.getByRole('button', { name: /^Approuver/ }))
    expect((await screen.findByRole('alert')).textContent).toMatch(failure === 409 ? /modifiée/ : failure === 'network' ? /Résultat non confirmé/ : /session|droits/i)
    expect(screen.getByText('Taxi client').textContent).toBe('Taxi client')
  })
  it.each([503, 'network', 'invalid'])('recovers from a %s list failure', async (failure) => {
    let broken = true
    serve(() => { if (!broken) return response(page()); if (failure === 'network') throw new Error('offline'); return response(failure === 'invalid' ? {} : { error: 'Unavailable' }, failure === 503 ? 503 : 200) })
    const user = userEvent.setup(); render(<Component />)
    expect((await screen.findByRole('alert')).textContent).not.toBe('')
    broken = false
    await user.click(screen.getByRole('button', { name: retry }))
    await screen.findByText('Taxi client')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: heading }))
  })
  it.each(['success', 'http', 'invalid', 'network'])('handles %s receipt access', async (kind) => {
    serve((url) => {
      if (!url.endsWith('/receipt-url')) return response(page([{ ...note, author: undefined }]))
      if (kind === 'network') throw new Error('offline')
      return response(kind === 'success' ? { url: 'https://receipts.example.test/signed' } : {}, kind === 'http' ? 403 : 200)
    })
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const user = userEvent.setup(); render(<Component />); await screen.findByText('Taxi client')
    expect(screen.getByText('Auteur non disponible').textContent).toBe('Auteur non disponible')
    await user.click(screen.getByRole('button', { name: /Voir le reçu/ }))
    if (kind === 'success') expect(open).toHaveBeenCalledWith('https://receipts.example.test/signed', '_blank', 'noopener,noreferrer')
    else { expect((await screen.findByRole('alert')).textContent).not.toBe(''); expect(open).not.toHaveBeenCalled() }
  })
  it('returns to the preceding page after the last item on page two is decided', async () => {
    let decided = false
    serve((url, init) => {
      if (init?.method === 'POST') { decided = true; return response({}) }
      const second = new URL(url, 'http://test').searchParams.get('page') === '2'
      return response(page(second && decided ? [] : [{ ...note, description: second ? 'Last expense' : 'First expense' }], second ? 2 : 1, decided ? 20 : 21))
    })
    const user = userEvent.setup(); render(<Component />); await screen.findByText('First expense')
    await user.click(screen.getByRole('button', { name: /Suivant/ })); await screen.findByText('Last expense')
    await user.click(screen.getByRole('button', { name: /^Approuver/ }))
    expect((await screen.findByText('First expense')).textContent).toBe('First expense')
    expect(screen.queryByText('Last expense')).toBeNull()
  })
})

describe('HR directory', () => {
  const alice = { id: 'alice', name: 'Alice', email: 'alice@example.test', role: 'employee', managerId: 'old-manager' }
  const manager = { id: 'manager', name: 'Marie', email: 'marie@example.test', role: 'manager', managerId: null }
  it.each(['manager', ''])('assigns %s and displays the confirmed directory', async (selection) => {
    let assigned: string | null = 'old-manager'
    mockFetch((url, init) => {
      if (init?.method === 'PUT') { assigned = JSON.parse(String(init.body)).managerId; return response({}) }
      if (url.includes('selectedManagerId')) return response({ selectedManager: { id: 'old-manager', name: 'Former manager', isEligible: false } })
      if (url.includes('role=manager')) return response(page([manager], 1, 1, false))
      return response(url.startsWith('/api/hr/users') ? page([{ ...alice, managerId: assigned }], 1, 1, false) : page([]))
    })
    const user = userEvent.setup(); render(<AdminConsole />)
    const select = await screen.findByRole('combobox', { name: /Manager de Alice/ }) as HTMLSelectElement
    await screen.findByRole('option', { name: /Former manager.*inactif/ })
    await waitFor(() => expect(select.disabled).toBe(false))
    await user.selectOptions(select, selection)
    await screen.findByText('Affectation enregistrée.')
    await waitFor(() => expect(select.value).toBe(selection))
    expect(assigned).toBe(selection || null)
  })
  it.each(['http', 'network'])('reports %s assignment failures without claiming success', async (kind) => {
    mockFetch((url, init) => {
      if (init?.method === 'PUT') { if (kind === 'network') throw new Error('offline'); return response({ error: 'Invalid manager' }, 400) }
      return response(url.includes('role=manager') ? page([manager], 1, 1, false) : url.startsWith('/api/hr/users') ? page([{ ...alice, managerId: null }], 1, 1, false) : page([]))
    })
    const user = userEvent.setup(); render(<AdminConsole />)
    const select = await screen.findByRole('combobox', { name: /Manager de Alice/ }) as HTMLSelectElement
    await waitFor(() => expect(select.disabled).toBe(false)); await user.selectOptions(select, 'manager')
    expect((await screen.findByRole('alert')).textContent).toMatch(kind === 'network' ? /non confirmé/ : /assignation|Invalid manager/)
    expect(screen.queryByText('Affectation enregistrée.')).toBeNull()
  })
  it.each(['http', 'network'])('recovers the directory after a %s failure and searches managers', async (kind) => {
    let failed = true
    const fetch = mockFetch((url) => {
      if (url.includes('role=manager')) return response(page([manager], 1, 1, false))
      if (url.startsWith('/api/hr/users') && failed) { if (kind === 'network') throw new Error('offline'); return response({}, 503) }
      return response(url.startsWith('/api/hr/users') ? page([{ ...alice, managerId: null }], 1, 1, false) : page([]))
    })
    const user = userEvent.setup(); render(<AdminConsole />); await screen.findByRole('alert')
    failed = false; await user.click(screen.getByRole('button', { name: 'Réessayer l’annuaire' }))
    expect((await screen.findByText('Alice')).textContent).toBe('Alice')
    await user.type(screen.getByRole('searchbox'), 'Marie')
    await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).includes('q=Marie'))).toBe(true))
    expect(within(screen.getByRole('combobox', { name: /Manager de Alice/ })).getByRole('option', { name: 'Marie' }).textContent).toBe('Marie')
  })
  it('reports a manager search error independently of the directory', async () => {
    mockFetch(url => response(url.includes('role=manager') ? {} : url.startsWith('/api/hr/users') ? page([], 1, 0, false) : page([]), url.includes('role=manager') ? 503 : 200))
    render(<AdminConsole />)
    expect((await screen.findByRole('alert')).textContent).toContain('rechercher les managers')
    expect(screen.getByText('Aucun employé ou manager dans cette entreprise.').textContent).toContain('Aucun')
  })
})
