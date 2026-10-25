import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { readTestTarget } from '../../../support/test-target'
import { employeeNote, ExpenseUi } from '../expense-ui'

test.use({ baseURL: readTestTarget() })

// Real login and rendered components; expense API responses are controlled.
// This proves the interaction of recovery, submission intent and pagination,
// not database idempotency, receipt storage or server authorization.
test('keyboard pagination survives an uncertain submission and a failed post-success refresh', async ({ page }) => {
  const initial = Array.from({ length: 25 }, (_, index) => ({
    ...employeeNote,
    id: `00000000-0000-4000-8000-${String(index + 301).padStart(12, '0')}`,
    amount: 1,
    description: `Historique ${index + 1}`,
  }))
  const created = { ...employeeNote, description: 'Nouvelle note de recette' }
  const submitted: Array<{ key: string; amount: FormDataEntryValue | null; date: FormDataEntryValue | null;
    description: FormDataEntryValue | null; receiptName: string; receiptSize: number; receiptHash: string }> = []
  let saved = false
  let staleRefresh = true
  await page.route('**/api/expense-notes*', async route => {
    const request = route.request()
    if (request.method() === 'POST') {
      const body = request.postDataBuffer()
      if (!body) throw new Error('Expected an actual multipart submission')
      const form = await new Request(request.url(), { method: 'POST',
        headers: { 'content-type': request.headers()['content-type'] }, body: new Uint8Array(body).buffer,
      }).formData()
      const receipt = form.get('receipt')
      if (!(receipt instanceof File)) throw new Error('Expected the submitted receipt bytes')
      submitted.push({ key: request.headers()['idempotency-key'], amount: form.get('amount'),
        date: form.get('expenseDate'), description: form.get('description'), receiptName: receipt.name,
        receiptSize: receipt.size, receiptHash: createHash('sha256').update(new Uint8Array(await receipt.arrayBuffer())).digest('hex'),
      })
      if (submitted.length === 1) return route.abort('failed')
      saved = true
      return route.fulfill({ status: 201, json: created, headers: { 'Idempotency-Replayed': 'true' } })
    }
    if (saved && staleRefresh) {
      staleRefresh = false
      return route.fulfill({ status: 500, json: { error: 'private database details' } })
    }
    const currentPage = Number(new URL(request.url()).searchParams.get('page'))
    const notes = saved ? [created, ...initial] : initial
    return route.fulfill({ json: {
      items: notes.slice((currentPage - 1) * 20, currentPage * 20),
      pagination: { page: currentPage, pageSize: 20, totalItems: notes.length },
      totals: { count: notes.length, amount: saved ? 37.34 : 25, scope: 'filtered' },
    } })
  })

  const ui = new ExpenseUi(page)
  await ui.signIn('EMPLOYEE')
  const pagination = page.getByRole('navigation', { name: 'Pagination de l’historique' })
  await expect(page.getByText('25 notes au total · 25,00 € sur l’ensemble', { exact: true })).toBeVisible()
  await pagination.getByRole('button', { name: 'Suivant', exact: true }).press('Enter')
  await expect(page.getByText('21–25 sur 25', { exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Historique 21', exact: true })).toBeVisible()
  await pagination.getByRole('button', { name: 'Précédent', exact: true }).press('Enter')
  await expect(page.getByRole('cell', { name: 'Historique 1', exact: true })).toBeVisible()

  await ui.fillExpense()
  await page.getByRole('button', { name: 'Soumettre', exact: true }).press('Enter')
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Résultat non confirmé')
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue(created.description)
  await expect(page.getByLabel('Reçu (image ou PDF)', { exact: true })).toHaveValue(/receipt\.png$/)
  expect(submitted).toHaveLength(1)
  await page.getByRole('button', { name: 'Réessayer la même soumission', exact: true }).press('Enter')

  const success = page.getByRole('status').filter({ hasText: /^Note de frais enregistrée\.$/ })
  await expect(success).toBeVisible()
  await expect(page.getByRole('main').getByRole('alert')).toContainText('erreur serveur')
  await expect(page.getByRole('main')).not.toContainText('private database details')
  await expect(page.getByRole('cell', { name: 'Historique 1', exact: true })).toBeVisible()
  await expect(page.getByLabel('Montant (€)', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Reçu (image ou PDF)', { exact: true })).toHaveValue('')
  expect(submitted).toHaveLength(2)
  expect(submitted[0].key).toMatch(/^[0-9a-f-]{36}$/i)
  expect(submitted[1].key).toBe(submitted[0].key)
  for (const attempt of submitted) {
    expect(attempt.amount).toBe('12.34')
    expect(attempt.date).toBe('2026-10-16')
    expect(attempt.description).toBe(created.description)
    expect(attempt.receiptName).toBe('receipt.png')
    expect(attempt.receiptSize).toBeGreaterThan(0)
  }
  expect(submitted[1].receiptSize).toBe(submitted[0].receiptSize)
  expect(submitted[1].receiptHash).toBe(submitted[0].receiptHash)

  await page.getByRole('button', { name: 'Réessayer', exact: true }).press('Enter')
  await expect(page.getByRole('heading', { name: 'Historique', exact: true })).toBeFocused()
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
  await expect(success).toBeVisible()
  await expect(page.getByRole('cell', { name: created.description, exact: true })).toBeVisible()
  await expect(page.getByText('26 notes au total · 37,34 € sur l’ensemble', { exact: true })).toBeVisible()
  await pagination.getByRole('button', { name: 'Suivant', exact: true }).press('Enter')
  await expect(page.getByText('21–26 sur 26', { exact: true })).toBeVisible()
  expect(submitted).toHaveLength(2)
})
