import { expect, test } from '@playwright/test'
import { readTestTarget } from '../../../support/test-target'
import { companyUsers, employeeNote, ExpenseUi, pagedDirectory, pagedNotes } from '../expense-ui'

test.use({ baseURL: readTestTarget() })

test('the employee sees server-provided routing and decision history', async ({ page }) => {
  const decidedNote = { ...employeeNote, id: '00000000-0000-4000-8000-000000000102', status: 'approved' }
  await page.route('**/api/expense-notes*', route => route.fulfill({ json: pagedNotes([employeeNote, decidedNote]) }))
  await page.route(`**/api/expense-notes/${employeeNote.id}/validation-status`, route => route.fulfill({
    json: { status: 'pending', validation: { kind: 'manager', reasonCode: 'direct_manager', message: 'En attente de validation par votre manager direct.' } },
  }))
  await page.route(`**/api/expense-notes/${decidedNote.id}/history`, route => route.fulfill({
    json: { items: [{ id: 'decision-1', fromStatus: 'pending', toStatus: 'approved', decidedAt: '2026-10-16T12:30:00.000Z', actor: { id: companyUsers[2].id, displayName: 'Vérificateur Test' } }] },
  }))

  await new ExpenseUi(page).signIn('EMPLOYEE')
  await page.getByRole('button', { name: 'Voir le circuit pour Taxi de recette', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'En attente de validation par votre manager direct.' })).toBeVisible()
  await page.getByRole('button', { name: 'Voir la décision pour Taxi de recette', exact: true }).click()
  await expect(page.getByText(/Approuvée par Vérificateur Test le/)).toBeVisible()
})

test('manager queue uses authorized author names from its DTOs', async ({ page }) => {
  const managerNote = { ...employeeNote, author: { id: employeeNote.userId, displayName: 'Alice Manager DTO' } }
  const missingAuthorNote = { ...employeeNote, id: '00000000-0000-4000-8000-000000000103', description: 'Auteur absent' }
  await page.route('**/api/manager/expense-notes*', route => route.fulfill({ json: pagedNotes([managerNote, missingAuthorNote]) }))
  await new ExpenseUi(page).signIn('MANAGER', '/manager')
  await expect(page.getByRole('cell', { name: 'Alice Manager DTO', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approuver la note de Alice Manager DTO, Taxi de recette', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Auteur non disponible', exact: true })).toBeVisible()
  await expect(page.getByText(employeeNote.userId)).toHaveCount(0)
})

test('HR queue uses authorized author names from its DTOs', async ({ page }) => {
  await page.route('**/api/hr/users*', route => route.fulfill({ json: pagedDirectory(companyUsers) }))
  await page.route('**/api/hr/expense-notes*', route => route.fulfill({ json: pagedNotes([
    { ...employeeNote, author: { id: employeeNote.userId, displayName: 'Alice HR DTO' } },
  ]) }))
  await new ExpenseUi(page).signIn('HR', '/hr')
  await expect(page.getByRole('cell', { name: 'Alice HR DTO', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approuver la note de Alice HR DTO, Taxi de recette', exact: true })).toBeVisible()
})
