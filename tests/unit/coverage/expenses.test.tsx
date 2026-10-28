// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ExpensesPage from '@/app/expenses/page'
import { deferred, mockFetch, note, page, response } from './ui-helpers'

beforeEach(() => {
  sessionStorage.clear()
  // jsdom constructs an empty File for file inputs populated by user-event.
  // Preserve the actual selected File as browsers do when constructing FormData.
  const BrowserFormData = window.FormData
  vi.stubGlobal('FormData', class extends BrowserFormData {
    constructor(form?: HTMLFormElement) {
      super(form)
      form?.querySelectorAll<HTMLInputElement>('input[type=file]').forEach(input => {
        if (input.files?.[0]) this.set(input.name, input.files[0])
      })
    }
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const key = 'expense-io:submission-history-check'
async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Montant (€)'), '18.75')
  fireEvent.change(screen.getByLabelText('Date', { exact: true }), { target: { value: '2026-10-20' } })
  await user.type(screen.getByLabelText('Description'), 'Taxi client')
  await user.upload(screen.getByLabelText('Reçu (image ou PDF)'), new File(['receipt'], 'receipt.png', { type: 'image/png', lastModified: 1 }))
}
function submit() { fireEvent.submit(screen.getByRole('button', { name: /Soumettre|Réessayer la même/ }).closest('form')!) }

describe('employee expense history', () => {
  it('shows all filtered totals and navigates both ways', async () => {
    mockFetch(url => { const p = Number(new URL(url, 'http://test').searchParams.get('page')); return response(page([{ ...note, description: p === 2 ? 'Second page' : 'First page', status: 'unexpected' }], p, 21)) })
    const user = userEvent.setup(); render(<ExpensesPage />); await screen.findByText('First page')
    expect(screen.getByText(/21 notes au total/).textContent).toContain('375')
    expect(screen.getByText('unexpected').textContent).toBe('unexpected')
    await user.click(screen.getByRole('button', { name: /Suivant/ })); await screen.findByText('Second page')
    await user.click(screen.getByRole('button', { name: /Précédent/ })); await screen.findByText('First page')
  })
  it.each(['http', 'network', 'invalid'])('recovers from %s history failures and restores focus', async kind => {
    let failed = true
    mockFetch(() => { if (!failed) return response(page([])); if (kind === 'network') throw new Error('offline'); return response({}, kind === 'http' ? 503 : 200) })
    const user = userEvent.setup(); render(<ExpensesPage />); await screen.findByRole('alert')
    expect(screen.getByText('Historique indisponible.').textContent).toBe('Historique indisponible.')
    failed = false; await user.click(screen.getByRole('button', { name: 'Réessayer' }))
    await screen.findByText('Aucune note de frais pour le moment.')
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Historique' }))
  })
  it.each(['success', 'http', 'invalid', 'network'])('handles %s receipt requests', async kind => {
    mockFetch(url => { if (!url.endsWith('/receipt-url')) return response(page()); if (kind === 'network') throw new Error('offline'); return response(kind === 'success' ? { url: 'https://receipt.example.test/one' } : {}, kind === 'http' ? 403 : 200) })
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const user = userEvent.setup(); render(<ExpensesPage />); await screen.findByText('Taxi client')
    await user.click(screen.getByRole('button', { name: /Voir le reçu pour/ }))
    if (kind === 'success') expect(open).toHaveBeenCalledWith('https://receipt.example.test/one', '_blank', 'noopener,noreferrer')
    else { expect((await screen.findByRole('alert')).textContent).not.toBe(''); expect(open).not.toHaveBeenCalled() }
  })
  it.each(['pending', 'approved', 'rejected'])('expands and collapses the %s workflow details', async status => {
    mockFetch(url => response(url.endsWith('/validation-status') ? { validation: { kind: 'manager', message: 'Marie doit valider', reasonCode: 'assigned' } } : url.endsWith('/history') ? { items: [{ id: 'decision', toStatus: status, decidedAt: status === 'rejected' ? 'invalid' : '2026-10-20T12:00:00Z', actor: { id: 'manager', displayName: 'Marie' } }] } : page([{ ...note, status }])))
    const user = userEvent.setup(); render(<ExpensesPage />); await screen.findByText('Taxi client')
    await user.click(screen.getByRole('button', { name: /Voir (le circuit|la décision) pour/ }))
    expect((await screen.findByText(status === 'pending' ? 'Marie doit valider' : /par Marie/)).textContent).toContain('Marie')
    if (status === 'rejected') expect(screen.getByText(/par Marie/).textContent).toContain('Date indisponible')
    await user.click(screen.getByRole('button', { name: /Masquer/ }))
    expect(screen.queryByText(status === 'pending' ? 'Marie doit valider' : /par Marie/)).toBeNull()
  })
  it.each([
    ['pending', {}, 200], ['pending', { validation: {} }, 200], ['approved', {}, 200],
    ['approved', { items: [{}] }, 200], ['pending', {}, 403], ['approved', null, 0],
  ])('reports invalid/unavailable %s details (%j, %s)', async (status, body, code) => {
    mockFetch(url => { if (url.includes('?')) return response(page([{ ...note, status }])); if (code === 0) throw new Error('offline'); return response(body, code) })
    const user = userEvent.setup(); render(<ExpensesPage />); await screen.findByText('Taxi client')
    await user.click(screen.getByRole('button', { name: /Voir (le circuit|la décision) pour/ }))
    expect((await screen.findByRole('alert')).textContent).not.toBe('')
  })
  it('explains an empty decision history', async () => {
    mockFetch(url => response(url.endsWith('/history') ? { items: [] } : page([{ ...note, status: 'approved' }])))
    const user = userEvent.setup(); render(<ExpensesPage />); await screen.findByText('Taxi client')
    await user.click(screen.getByRole('button', { name: /Voir la décision pour/ }))
    expect((await screen.findByText(/aucun événement/)).textContent).toContain('aucun événement')
  })
})

describe('expense submission', () => {
  it('sends the form with an idempotency key, clears it only on success, and refreshes history', async () => {
    let sent = false
    const fetch = mockFetch((_url, init) => { if (init?.method === 'POST') { sent = true; return response({}, 201) } return response(page(sent ? [note] : [])) })
    const user = userEvent.setup(); render(<ExpensesPage />); await screen.findByText('Aucune note de frais pour le moment.')
    await fillForm(user); submit()
    await screen.findByText('Note de frais enregistrée.')
    expect((screen.getByLabelText('Montant (€)') as HTMLInputElement).value).toBe('')
    expect(sessionStorage.getItem(key)).toBeNull()
    const init = fetch.mock.calls.find(([, options]) => options?.method === 'POST')![1]!
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
    expect((init.body as FormData).get('description')).toBe('Taxi client')
    expect((await screen.findByText('Taxi client')).textContent).toBe('Taxi client')
  })
  it.each([400, 409, 503, 'network'])('distinguishes a definite rejection from an uncertain %s result', async code => {
    mockFetch((_url, init) => { if (!init?.method) return response(page([])); if (code === 'network') throw new TypeError('offline'); return response({ error: 'Unable to submit' }, Number(code)) })
    const user = userEvent.setup(); render(<ExpensesPage />); await fillForm(user); submit()
    expect((await screen.findByRole('alert')).textContent).not.toBe('')
    expect(sessionStorage.getItem(key)).toBe(code === 400 ? null : '1')
    expect(screen.queryByRole('button', { name: 'Réessayer la même soumission' }) !== null).toBe(code !== 400)
  })
  it('reuses the same key and receipt after an uncertain request, but blocks changed content', async () => {
    let attempts = 0
    const fetch = mockFetch((_url, init) => { if (!init?.method) return response(page([])); attempts++; return response({}, attempts === 1 ? 503 : 201) })
    const user = userEvent.setup(); render(<ExpensesPage />); await fillForm(user); submit()
    await screen.findByRole('button', { name: 'Réessayer la même soumission' })
    await user.type(screen.getByLabelText('Description'), ' changed'); submit()
    await screen.findByText(/Le formulaire a changé/)
    expect(attempts).toBe(1)
    await user.clear(screen.getByLabelText('Description')); await user.type(screen.getByLabelText('Description'), 'Taxi client'); submit()
    await screen.findByText('Note de frais enregistrée.')
    const posts = fetch.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(posts).toHaveLength(2)
    expect(posts[0][1]?.headers).toEqual(posts[1][1]?.headers)
  })
  it('requires history acknowledgement after a reload and permits abandoning an uncertain attempt', async () => {
    sessionStorage.setItem(key, '1')
    mockFetch((_url, init) => response(init?.method ? {} : page([]), init?.method ? 503 : 200))
    const user = userEvent.setup(); render(<ExpensesPage />)
    expect((screen.getByRole('button', { name: 'Soumettre' }) as HTMLButtonElement).disabled).toBe(true)
    submit(); expect(screen.getByRole('alert').textContent).toContain('tentative précédente')
    await user.click(screen.getByRole('button', { name: 'J’ai vérifié l’historique, continuer' }))
    expect(sessionStorage.getItem(key)).toBeNull()
    await fillForm(user); submit(); await screen.findByRole('button', { name: /abandonner cette tentative/ })
    await user.click(screen.getByRole('button', { name: /abandonner cette tentative/ }))
    expect((await screen.findByText(/Tentative abandonnée/)).textContent).toContain('historique')
    expect(sessionStorage.getItem(key)).toBeNull()
  })
  it('prevents duplicate submissions while awaiting the response', async () => {
    const pending = deferred<Response>()
    const fetch = mockFetch((_url, init) => init?.method ? pending.promise : response(page([])))
    const user = userEvent.setup(); render(<ExpensesPage />); await fillForm(user)
    const form = screen.getByRole('button', { name: 'Soumettre' }).closest('form')!
    fireEvent.submit(form); fireEvent.submit(form)
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect((screen.getByRole('button', { name: 'Envoi…' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => pending.resolve(response({}, 201)))
    await screen.findByText('Note de frais enregistrée.')
  })
  it('continues safely when session storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('disabled') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('disabled') })
    mockFetch((_url, init) => response(init?.method ? {} : page([])))
    const user = userEvent.setup(); render(<ExpensesPage />); await fillForm(user); submit()
    expect((await screen.findByText('Note de frais enregistrée.')).textContent).toBe('Note de frais enregistrée.')
  })
})

describe('receipt OCR suggestions', () => {
  it('requires a receipt before requesting OCR', async () => {
    const fetch = mockFetch(() => response(page([])))
    const user = userEvent.setup(); render(<ExpensesPage />)
    await user.click(screen.getByRole('button', { name: 'Pré-remplir depuis le reçu' }))
    expect(screen.getByRole('alert').textContent).toBe('Sélectionne d’abord un reçu.')
    expect(fetch.mock.calls.every(([url]) => !String(url).includes('suggestion'))).toBe(true)
  })
  it.each([
    [{ amount: 18.75, expenseDate: '2026-10-20' }, /Analyse terminée/],
    [{}, /Aucune information reconnue/],
    [{ amount: 18.75 }, /Date non reconnu/],
    [{ expenseDate: '2026-10-20' }, /Montant non reconnu/],
  ])('fills only recognized fields from %j', async (suggestion, message) => {
    mockFetch(url => response(url.includes('suggestion') ? suggestion : page([])))
    const user = userEvent.setup(); render(<ExpensesPage />)
    await user.upload(screen.getByLabelText('Reçu (image ou PDF)'), new File(['receipt'], 'receipt.png', { type: 'image/png' }))
    await user.click(screen.getByRole('button', { name: 'Pré-remplir depuis le reçu' }))
    await screen.findByText(message)
    expect((screen.getByLabelText('Montant (€)') as HTMLInputElement).value).toBe('amount' in suggestion ? '18.75' : '')
    expect((screen.getByLabelText('Date', { exact: true }) as HTMLInputElement).value).toBe('expenseDate' in suggestion ? '2026-10-20' : '')
  })
  it.each(['http', 'network', 'invalid'])('reports %s OCR failures without filling the form', async kind => {
    mockFetch(url => { if (!url.includes('suggestion')) return response(page([])); if (kind === 'network') throw new Error('offline'); return response(null, kind === 'http' ? 503 : 200) })
    const user = userEvent.setup(); render(<ExpensesPage />)
    await user.upload(screen.getByLabelText('Reçu (image ou PDF)'), new File(['receipt'], 'receipt.png', { type: 'image/png' }))
    await user.click(screen.getByRole('button', { name: 'Pré-remplir depuis le reçu' }))
    expect((await screen.findByRole('alert')).textContent).not.toBe('')
    expect((screen.getByLabelText('Montant (€)') as HTMLInputElement).value).toBe('')
  })
  it('preserves fields edited while OCR is running', async () => {
    const pending = deferred<Response>()
    mockFetch(url => url.includes('suggestion') ? pending.promise : response(page([])))
    const user = userEvent.setup(); render(<ExpensesPage />)
    await user.upload(screen.getByLabelText('Reçu (image ou PDF)'), new File(['receipt'], 'receipt.png', { type: 'image/png' }))
    await user.click(screen.getByRole('button', { name: 'Pré-remplir depuis le reçu' }))
    await user.type(screen.getByLabelText('Montant (€)'), '99')
    fireEvent.change(screen.getByLabelText('Date', { exact: true }), { target: { value: '2026-10-21' } })
    await act(async () => pending.resolve(response({ amount: 18.75, expenseDate: '2026-10-20' })))
    await screen.findByText(/Saisie conservée : montant et date/)
    expect((screen.getByLabelText('Montant (€)') as HTMLInputElement).value).toBe('99')
    expect((screen.getByLabelText('Date', { exact: true }) as HTMLInputElement).value).toBe('2026-10-21')
  })
  it.each([200, 503])('ignores a stale OCR response (%s) after the receipt changes', async status => {
    const pending = deferred<Response>()
    mockFetch(url => url.includes('suggestion') ? pending.promise : response(page([])))
    const user = userEvent.setup(); render(<ExpensesPage />)
    await user.upload(screen.getByLabelText('Reçu (image ou PDF)'), new File(['one'], 'one.png', { type: 'image/png' }))
    await user.click(screen.getByRole('button', { name: 'Pré-remplir depuis le reçu' }))
    await user.upload(screen.getByLabelText('Reçu (image ou PDF)'), new File(['two'], 'two.png', { type: 'image/png' }))
    await act(async () => pending.resolve(response({ amount: 99 }, status)))
    expect((screen.getByLabelText('Montant (€)') as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
