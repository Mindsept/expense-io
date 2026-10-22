import { expect, test } from '@playwright/test'
import { readTestTarget } from '../../../support/test-target'
import { companyUsers, deferred, employeeNote, ExpenseUi } from '../expense-ui'

test.use({ baseURL: readTestTarget() })

test('an uncertain submission preserves every field and does not retry automatically', async ({ page }) => {
  let posts = 0
  await page.route('**/api/expense-notes', async route => {
    if (route.request().method() === 'POST') {
      posts += 1
      await route.abort('failed')
    } else await route.fulfill({ json: [employeeNote] })
  })
  const ui = new ExpenseUi(page)
  await ui.signIn('EMPLOYEE')
  await ui.fillExpense()
  await page.getByRole('button', { name: 'Soumettre', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Résultat non confirmé')
  await expect(page.getByLabel('Montant (€)', { exact: true })).toHaveValue('12.34')
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2026-10-16')
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Nouvelle note de recette')
  await expect(page.getByLabel('Reçu (image ou PDF)', { exact: true })).toHaveValue(/receipt\.png$/)
  await expect(page.getByRole('button', { name: 'Soumettre', exact: true })).toBeEnabled()
  expect(posts).toBe(1)
})

test('a confirmed submission keeps its success message and stale history can be refreshed', async ({ page }) => {
  let reads = 0
  await page.route('**/api/expense-notes', async route => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 201, json: employeeNote })
    reads += 1
    if (reads === 2) return route.fulfill({ status: 500, body: 'private server detail' })
    return route.fulfill({ json: reads === 1 ? [employeeNote] : [{ ...employeeNote, description: 'Historique actualisé' }] })
  })
  const ui = new ExpenseUi(page)
  await ui.signIn('EMPLOYEE')
  await expect(page.getByRole('cell', { name: employeeNote.description, exact: true })).toBeVisible()
  await ui.fillExpense()
  await page.getByRole('button', { name: 'Soumettre', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Note de frais enregistrée.')
  await expect(page.getByRole('alert')).toContainText('erreur serveur')
  await expect(page.getByRole('alert')).not.toContainText('private')
  await expect(page.getByRole('cell', { name: employeeNote.description, exact: true })).toBeVisible()
  const retry = page.getByRole('button', { name: 'Réessayer', exact: true })
  await expect(retry).toBeEnabled()
  await retry.click()
  await expect(page.getByRole('cell', { name: 'Historique actualisé', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Historique', exact: true })).toBeFocused()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('status')).toHaveText('Note de frais enregistrée.')
})

test('a manager conflict preserves the row until an explicit refresh confirms removal', async ({ page }) => {
  let reads = 0
  let decisions = 0
  await page.route('**/api/manager/expense-notes', route => {
    reads += 1
    return route.fulfill({ json: reads === 1 ? [employeeNote] : [] })
  })
  await page.route(`**/api/manager/expense-notes/${employeeNote.id}/approve`, route => {
    decisions += 1
    return route.fulfill({ status: 409, json: { detail: 'Conflict' } })
  })
  await new ExpenseUi(page).signIn('MANAGER', '/manager')
  await page.getByRole('button', { name: /^Approuver la note/ }).click()
  await expect(page.getByRole('alert')).toContainText('modifiée depuis son affichage')
  await expect(page.getByRole('cell', { name: employeeNote.description, exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toHaveCount(0)
  expect(reads).toBe(1)
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click()
  await expect(page.getByText('Aucune note en attente.', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'En attente (0)', exact: true })).toBeFocused()
  expect(decisions).toBe(1)
})

test('a successful manager decision is announced independently of a failed refresh', async ({ page }) => {
  let reads = 0
  await page.route('**/api/manager/expense-notes', route => {
    reads += 1
    if (reads === 2) return route.fulfill({ status: 200, contentType: 'application/json', body: '{broken' })
    return route.fulfill({ json: reads === 1 ? [employeeNote] : [] })
  })
  await page.route(`**/api/manager/expense-notes/${employeeNote.id}/approve`, route => route.fulfill({ json: { status: 'approved' } }))
  await new ExpenseUi(page).signIn('MANAGER', '/manager')
  await page.getByRole('button', { name: /^Approuver la note/ }).click()
  await expect(page.getByRole('status')).toHaveText('Note de frais approuvée.')
  await expect(page.getByRole('alert')).toContainText('Impossible de charger')
  await expect(page.getByRole('cell', { name: employeeNote.description, exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'En attente (1)', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click()
  await expect(page.getByText('Aucune note en attente.', { exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toHaveText('Note de frais approuvée.')
})

test('HR assignments lock the whole group and each stale section has its own retry', async ({ page }) => {
  const assignment = deferred()
  let userReads = 0
  let noteReads = 0
  let writes = 0
  await page.route('**/api/hr/users', route => {
    userReads += 1
    return userReads === 2
      ? route.fulfill({ status: 500, json: { error: 'private' } })
      : route.fulfill({ json: companyUsers })
  })
  await page.route('**/api/hr/expense-notes', route => {
    noteReads += 1
    return noteReads === 2
      ? route.fulfill({ status: 200, contentType: 'application/json', body: '{broken' })
      : route.fulfill({ json: [employeeNote] })
  })
  await page.route('**/api/hr/users/*/manager', async route => {
    writes += 1
    await assignment.promise
    await route.fulfill({ json: { success: true } })
  })
  await new ExpenseUi(page).signIn('HR', '/hr')
  await expect(page.getByRole('cell', { name: employeeNote.description, exact: true })).toBeVisible()
  const first = page.getByRole('combobox', { name: 'Manager de Alice Test', exact: true })
  const second = page.getByRole('combobox', { name: 'Manager de Bob Test', exact: true })
  await first.selectOption(companyUsers[2].id)
  await expect(first).toBeDisabled()
  await expect(second).toBeDisabled()
  await expect(page.getByRole('combobox', { name: 'Manager de Manager Test', exact: true })).toBeDisabled()
  assignment.release()
  await expect(page.getByRole('status')).toHaveText('Affectation enregistrée.')
  await expect(page.getByRole('alert')).toHaveCount(2)
  await expect(page.getByRole('cell', { name: employeeNote.description, exact: true })).toBeVisible()
  await expect(second).toBeEnabled()
  await page.getByRole('button', { name: 'Réessayer l’annuaire', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Organigramme (3)', exact: true })).toBeFocused()
  await expect(page.getByRole('button', { name: 'Réessayer les notes', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Réessayer les notes', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Notes des managers racine en attente (1)', exact: true })).toBeFocused()
  await expect(page.getByRole('status')).toHaveText('Affectation enregistrée.')
  expect(writes).toBe(1)
})
