import { expect, test } from '@playwright/test'
import { readTestTarget } from '../../../support/test-target'
import { deferred, employeeNote, ExpenseUi } from '../expense-ui'

test.use({ baseURL: readTestTarget() })

test('submitting while OCR is pending ends its spinner and ignores the old suggestion', async ({ page }) => {
  const ocr = deferred()
  const refresh = deferred()
  let submitted = false
  await page.route('**/api/expense-notes', async route => {
    const posting = route.request().method() === 'POST'
    if (posting) submitted = true
    else if (submitted) await refresh.promise
    await route.fulfill({ status: posting ? 201 : 200, json: posting ? employeeNote : [] })
  })
  await page.route('**/api/expense-notes/receipt-suggestion', async route => {
    await ocr.promise
    await route.fulfill({ json: { amount: 99, expenseDate: '2026-01-01' } })
  })
  const ui = new ExpenseUi(page)
  await ui.signIn('EMPLOYEE')
  await ui.fillExpense()
  const request = page.waitForRequest('**/api/expense-notes/receipt-suggestion')
  await page.getByRole('button', { name: 'Pré-remplir depuis le reçu', exact: true }).click()
  await request
  await expect(page.getByRole('button', { name: 'Analyse du reçu…', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Soumettre', exact: true }).click()
  // Submission success is independent of the history refresh. Both statuses
  // intentionally coexist here; do not select an arbitrary first/last status.
  await expect(page.getByRole('status').filter({ hasText: /^Chargement…$/ })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: /^Note de frais enregistrée\.$/ })).toHaveText('Note de frais enregistrée.')
  await expect(page.getByRole('button', { name: 'Pré-remplir depuis le reçu', exact: true })).toBeEnabled()
  refresh.release()
  const response = page.waitForResponse('**/api/expense-notes/receipt-suggestion')
  ocr.release()
  await (await response).finished()
  await expect(page.getByLabel('Montant (€)', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Pré-remplir depuis le reçu', exact: true })).toBeEnabled()
})

test('the newer file wins when B finishes before A and manual edits stay intact', async ({ page }) => {
  const first = deferred()
  const second = deferred()
  let requests = 0
  await page.route('**/api/expense-notes', route => route.fulfill({ json: [] }))
  await page.route('**/api/expense-notes/receipt-suggestion', async route => {
    const sequence = ++requests
    await (sequence === 1 ? first : second).promise
    await route.fulfill({ json: sequence === 1
      ? { amount: 99, expenseDate: '2026-01-01' }
      : { amount: 12.34, expenseDate: '2026-10-16' } })
  })
  const ui = new ExpenseUi(page)
  await ui.signIn('EMPLOYEE')
  await ui.attachReceipt('a.png')
  const requestA = page.waitForRequest('**/api/expense-notes/receipt-suggestion')
  await page.getByRole('button', { name: 'Pré-remplir depuis le reçu', exact: true }).click()
  await requestA
  await ui.attachReceipt('b.png')
  const requestB = page.waitForRequest('**/api/expense-notes/receipt-suggestion')
  await page.getByRole('button', { name: 'Pré-remplir depuis le reçu', exact: true }).click()
  await requestB
  await page.getByLabel('Montant (€)', { exact: true }).fill('20.00')
  second.release()
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2026-10-16')
  await expect(page.getByLabel('Montant (€)', { exact: true })).toHaveValue('20.00')
  await expect(page.getByRole('status').filter({ hasText: 'Saisie conservée : montant.' })).toContainText('Saisie conservée : montant.')
  const responseA = page.waitForResponse('**/api/expense-notes/receipt-suggestion')
  first.release()
  await (await responseA).finished()
  await expect(page.getByLabel('Montant (€)', { exact: true })).toHaveValue('20.00')
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2026-10-16')
  await expect(page.getByRole('button', { name: 'Pré-remplir depuis le reçu', exact: true })).toBeEnabled()
})
