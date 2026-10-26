import { expect, test } from '@playwright/test'
import { readTestTarget } from '../../../support/test-target'
import { ExpenseUi, pagedNotes } from '../expense-ui'

test.use({ baseURL: readTestTarget() })

test('description counter follows trimmed UTF-16 length without a live region or moving focus', async ({ page }) => {
  await page.route('**/api/expense-notes*', route => route.fulfill({ json: pagedNotes([]) }))
  await new ExpenseUi(page).signIn('EMPLOYEE')
  const description = page.getByLabel('Description', { exact: true })
  const counter = page.locator('#description-counter')
  await expect(counter).toHaveText('4000 caractères restants')
  await expect(description).toHaveAccessibleDescription(/4000 caractères restants/)
  await expect(counter).not.toHaveAttribute('aria-live')
  await expect(counter).not.toHaveAttribute('role')
  await description.fill('Taxi')
  await expect(counter).toHaveText('3996 caractères restants')
  await description.fill('  Taxi 😀  ')
  await expect(counter).toHaveText('3993 caractères restants')
  await description.fill('e\u0301')
  await expect(counter).toHaveText('3998 caractères restants')
  await description.pressSequentially('x')
  await expect(description).toBeFocused()
  await expect(counter).toHaveText('3997 caractères restants')
})

test('description counter displays the exact boundary and excess without weakening the submission contract', async ({ page }) => {
  await page.route('**/api/expense-notes*', route => route.fulfill({ json: pagedNotes([]) }))
  await new ExpenseUi(page).signIn('EMPLOYEE')
  const description = page.getByLabel('Description', { exact: true })
  const counter = page.locator('#description-counter')
  await description.fill('😀'.repeat(2000))
  await expect(counter).toHaveText('0 caractère restant')
  await description.fill(`  ${'x'.repeat(4000)}  `)
  await expect(counter).toHaveText('0 caractère restant')
  await description.fill('x'.repeat(4001))
  await expect(counter).toHaveText('1 caractère en trop')
  await description.fill('😀'.repeat(2001))
  await expect(counter).toHaveText('2 caractères en trop')
})

test('description count and text survive an uncertain submission and reset only after success', async ({ page }) => {
  let posts = 0
  await page.route('**/api/expense-notes*', route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: pagedNotes([]) })
    posts += 1
    return posts === 1 ? route.abort('failed') : route.fulfill({ status: 201, json: {} })
  })
  const ui = new ExpenseUi(page)
  await ui.signIn('EMPLOYEE')
  await ui.fillExpense()
  await page.getByLabel('Description', { exact: true }).fill('Taxi 😀')
  await page.getByRole('button', { name: 'Soumettre', exact: true }).click()
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Résultat non confirmé')
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Taxi 😀')
  await expect(page.locator('#description-counter')).toHaveText('3993 caractères restants')
  await page.getByRole('button', { name: 'Réessayer la même soumission', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: /^Note de frais enregistrée\.$/ })).toHaveText('Note de frais enregistrée.')
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('')
  await expect(page.locator('#description-counter')).toHaveText('4000 caractères restants')
  expect(posts).toBe(2)
})
