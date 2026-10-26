import { expect, test } from '@playwright/test'
import { readTestTarget } from '../../../support/test-target'
import { employeeNote, ExpenseUi } from '../expense-ui'

test.use({ baseURL: readTestTarget() })

function notesPage(page: number) {
  const all = Array.from({ length: 25 }, (_, index) => ({
    ...employeeNote,
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    amount: index + 1,
    description: `Note ${index + 1}`,
  }))
  const items = all.slice((page - 1) * 20, page * 20)
  return {
    items,
    pagination: { page, pageSize: 20, totalItems: 25 },
    totals: { amount: 325, count: 25, scope: 'filtered' },
  }
}

function directoryPage(page: number) {
  const all = Array.from({ length: 24 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 301).padStart(12, '0')}`,
    name: index === 0 ? 'Alice Test' : `Employee ${index + 1}`,
    email: `employee${index + 1}@example.test`,
    role: 'employee',
    managerId: index === 0 ? '00000000-0000-4000-8000-000000000399' : null,
  }))
  all.push({ id: '00000000-0000-4000-8000-000000000399', name: 'Manager outside page', email: 'manager@example.test', role: 'manager', managerId: null })
  return {
    items: all.slice((page - 1) * 20, page * 20),
    pagination: { page, pageSize: 20, totalItems: 25 },
    totals: { count: 25, scope: 'filtered' },
    selectedManager: { id: all[0].managerId, name: 'Manager outside page', role: 'manager', isActive: true, isEligible: true },
  }
}

test('employee history pages show server-wide totals and only the requested items', async ({ page }) => {
  const requestedPages: string[] = []
  await page.route('**/api/expense-notes*', async route => {
    if (route.request().method() !== 'GET') return route.continue()
    const url = new URL(route.request().url())
    requestedPages.push(url.searchParams.get('page') ?? '')
    await route.fulfill({ json: notesPage(Number(url.searchParams.get('page'))) })
  })
  await new ExpenseUi(page).signIn('EMPLOYEE')
  await expect(page.getByText('25 notes au total · 325,00 € sur l’ensemble', { exact: true })).toBeVisible()
  await expect(page.getByRole('row')).toHaveCount(21)
  await page.getByRole('navigation', { name: 'Pagination de l’historique' }).getByRole('button', { name: 'Suivant' }).click()
  await expect(page.getByRole('row')).toHaveCount(6)
  await expect(page.getByText('21–25 sur 25')).toBeVisible()
  expect(requestedPages).toEqual(['1', '2'])
})

test('HR pages the directory and searches managers beyond the current directory page', async ({ page }) => {
  const directoryPages: string[] = []
  await page.route('**/api/hr/users*', async route => {
    const url = new URL(route.request().url())
    const pageNumber = Number(url.searchParams.get('page') ?? 1)
    if (url.searchParams.get('selectedManagerId')) {
      return route.fulfill({ json: directoryPage(pageNumber) })
    }
    if (url.searchParams.get('role') === 'manager') {
      return route.fulfill({ json: {
        items: [{ id: '00000000-0000-4000-8000-000000000399', name: 'Manager outside page', email: 'manager@example.test', role: 'manager', managerId: null }],
        pagination: { page: pageNumber, pageSize: 20, totalItems: 1 }, totals: { count: 1, scope: 'filtered' },
      } })
    }
    directoryPages.push(String(pageNumber))
    return route.fulfill({ json: directoryPage(pageNumber) })
  })
  await page.route('**/api/hr/expense-notes*', route => route.fulfill({ json: notesPage(1) }))
  await new ExpenseUi(page).signIn('HR', '/hr')
  const directory = page.getByRole('heading', { name: 'Organigramme (25)', exact: true }).locator('xpath=..')
  await expect(directory.getByRole('row')).toHaveCount(21)
  await page.getByLabel('Rechercher parmi les managers actifs de l’entreprise').fill('Manager outside page')
  const managerSelect = page.getByLabel('Manager de Alice Test (employee1@example.test)', { exact: true })
  await expect(managerSelect.locator('option', { hasText: 'Manager outside page' })).toHaveCount(1)
  await expect(managerSelect).toHaveValue('00000000-0000-4000-8000-000000000399')
  await page.getByRole('navigation', { name: 'Pagination de l’annuaire' }).getByRole('button', { name: 'Suivant' }).click()
  await expect(page.getByText('21–25 sur 25')).toBeVisible()
  expect(directoryPages).toEqual(['1', '2'])
})
