import { expect, test } from '@playwright/test'
import { readTestTarget } from '../../../support/test-target'
import { companyUsers, deferred, employeeNote, ExpenseUi, pagedDirectory, pagedNotes } from '../expense-ui'

test.use({ baseURL: readTestTarget() })

const firstNote = { ...employeeNote, author: { id: employeeNote.userId, displayName: 'Alice Test' } }
const secondNote = { ...firstNote, id: '00000000-0000-4000-8000-000000000102', expenseDate: '2026-10-17' }

for (const screen of [
  { role: 'MANAGER' as const, path: '/manager', api: 'manager', heading: 'En attente' },
  { role: 'HR' as const, path: '/hr', api: 'hr', heading: 'Notes à valider par les RH' },
]) {
  test(`${screen.role}: initial loading and failure never announce a fabricated zero total`, async ({ page }) => {
    const response = deferred()
    await page.route('**/api/hr/users*', async route => {
      await response.promise
      await route.fulfill({ status: 503, json: {} })
    })
    await page.route(`**/api/${screen.api}/expense-notes*`, async route => {
      await response.promise
      await route.fulfill({ status: 503, json: {} })
    })
    await new ExpenseUi(page).signIn(screen.role, screen.path)
    await expect(page.getByRole('heading', { name: screen.heading, exact: true })).toBeVisible()
    await expect(page.getByText(/Total des notes en attente/)).toHaveCount(0)
    await expect(page.getByText(/personnes dans l’annuaire/)).toHaveCount(0)
    response.release()
    await expect(page.getByText('Liste indisponible.', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: screen.heading, exact: true })).toBeVisible()
    await expect(page.getByText('Aucune note en attente.', { exact: true })).toHaveCount(0)
    await expect(page.getByText(/Total des notes en attente/)).toHaveCount(0)
  })

  test(`${screen.role}: keyboard decisions distinguish similar notes and restore focus after removal`, async ({ page }) => {
    let decided = false
    await page.route('**/api/hr/users*', route => route.fulfill({ json: pagedDirectory(companyUsers) }))
    await page.route(`**/api/${screen.api}/expense-notes*`, route => route.fulfill({ json: pagedNotes(decided ? [secondNote] : [firstNote, secondNote]) }))
    await page.route(`**/api/${screen.api}/expense-notes/${firstNote.id}/approve`, route => {
      decided = true
      return route.fulfill({ json: { status: 'approved' } })
    })
    await new ExpenseUi(page).signIn(screen.role, screen.path)
    const first = page.getByRole('button', { name: 'Approuver la note de Alice Test, Taxi de recette, 16 oct. 2026', exact: true })
    const second = page.getByRole('button', { name: 'Approuver la note de Alice Test, Taxi de recette, 17 oct. 2026', exact: true })
    await expect(second).toBeVisible()
    await first.focus()
    await page.keyboard.press('Enter')
    await expect(first).toHaveCount(0)
    await expect(page.getByRole('heading', { name: `${screen.heading} (1)`, exact: true })).toBeFocused()
    await expect(page.getByRole('status')).toHaveText('Note de frais approuvée.')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('region', { name: /en attente, tableau défilant/ })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Voir le reçu de Alice Test, Taxi de recette, 17 oct. 2026', exact: true })).toBeFocused()
    await expect(second).toBeEnabled()
  })
}

test('HR homonyms have distinct manager labels and a late decision does not steal typing focus', async ({ page }) => {
  const response = deferred()
  let decided = false
  const homonyms = [companyUsers[0], { ...companyUsers[1], name: companyUsers[0].name }, companyUsers[2]]
  await page.route('**/api/hr/users*', route => route.fulfill({ json: pagedDirectory(homonyms) }))
  await page.route('**/api/hr/expense-notes*', route => route.fulfill({ json: pagedNotes(decided ? [] : [firstNote]) }))
  await page.route(`**/api/hr/expense-notes/${firstNote.id}/approve`, async route => {
    await response.promise
    decided = true
    await route.fulfill({ json: { status: 'approved' } })
  })
  await new ExpenseUi(page).signIn('HR', '/hr')
  await expect(page.getByRole('combobox', { name: 'Manager de Alice Test (alice@example.test)', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Manager de Alice Test (bob@example.test)', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^Approuver la note/ }).click()
  const search = page.getByRole('searchbox', { name: 'Rechercher parmi les managers actifs de l’entreprise', exact: true })
  await search.fill('Manager')
  response.release()
  await expect(page.getByText('Aucune note en attente.', { exact: true })).toBeVisible()
  await expect(search).toBeFocused()
  await page.keyboard.type(' Test')
  await expect(search).toHaveValue('Manager Test')
})

test('employee workflow has dated names and a single announcement region, including failures', async ({ page }) => {
  const response = deferred()
  await page.route('**/api/expense-notes*', route => route.fulfill({ json: pagedNotes([firstNote, secondNote]) }))
  await page.route(`**/api/expense-notes/${firstNote.id}/validation-status`, async route => {
    await response.promise
    await route.fulfill({ json: { validation: { kind: 'manager', reasonCode: 'direct_manager', message: 'En attente du manager direct.' } } })
  })
  await page.route(`**/api/expense-notes/${secondNote.id}/validation-status`, route => route.fulfill({ status: 503, json: {} }))
  await new ExpenseUi(page).signIn('EMPLOYEE')
  const first = page.getByRole('button', { name: 'Voir le circuit pour Taxi de recette, 16 oct. 2026', exact: true })
  await first.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status')).toHaveText('Chargement du circuit…')
  await expect(page.locator('[role="status"] [role="status"], [aria-live] [role="status"]')).toHaveCount(0)
  response.release()
  await expect(page.getByRole('status')).toHaveText('En attente du manager direct.')
  const toggle = page.getByRole('button', { name: 'Masquer le circuit pour Taxi de recette, 16 oct. 2026', exact: true })
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(toggle).toHaveAttribute('aria-controls', `workflow-${firstNote.id}`)
  await toggle.press('Enter')
  await expect(page.getByRole('status')).toHaveCount(0)
  await page.getByRole('button', { name: 'Voir le circuit pour Taxi de recette, 17 oct. 2026', exact: true }).press('Enter')
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(1)
  await expect(page.locator('[role="alert"] [role="alert"], [aria-live] [role="alert"]')).toHaveCount(0)
})

test('employee submits and opens a receipt with the keyboard, with associated upload help', async ({ page }) => {
  let posts = 0
  await page.route('**/api/expense-notes*', route => {
    if (route.request().method() === 'POST') posts += 1
    return route.fulfill({ json: pagedNotes([employeeNote]) })
  })
  await page.route(`**/api/expense-notes/${employeeNote.id}/receipt-url`, route => route.fulfill({ json: { url: `${readTestTarget()}/login` } }))
  const ui = new ExpenseUi(page)
  await ui.signIn('EMPLOYEE')
  await expect(page.getByLabel('Reçu (image ou PDF)', { exact: true })).toHaveAccessibleDescription(/PNG, JPEG, WebP ou PDF, jusqu’à 10 Mio/)
  await ui.fillExpense()
  await page.getByLabel('Description', { exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Reçu (image ou PDF)', { exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Pré-remplir depuis le reçu', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Soumettre', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status')).toHaveText('Note de frais enregistrée.')
  expect(posts).toBe(1)
  const popup = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Voir le reçu pour Taxi de recette, 16 oct. 2026', exact: true }).press('Enter')
  await (await popup).close()
})

for (const screen of [
  { role: 'EMPLOYEE' as const, path: '/expenses', region: 'Historique des notes de frais, tableau défilant' },
  { role: 'MANAGER' as const, path: '/manager', region: 'Notes en attente, tableau défilant' },
  { role: 'HR' as const, path: '/hr', region: 'Notes à valider par les RH, tableau défilant' },
]) {
  test(`${screen.role}: small viewport keeps the table in a keyboard scroll region`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 })
    await page.route('**/api/expense-notes*', route => route.fulfill({ json: pagedNotes([firstNote, secondNote]) }))
    await page.route('**/api/manager/expense-notes*', route => route.fulfill({ json: pagedNotes([firstNote, secondNote]) }))
    await page.route('**/api/hr/expense-notes*', route => route.fulfill({ json: pagedNotes([firstNote, secondNote]) }))
    await page.route('**/api/hr/users*', route => route.fulfill({ json: pagedDirectory(companyUsers) }))
    await new ExpenseUi(page).signIn(screen.role, screen.path)
    const region = page.getByRole('region', { name: screen.region, exact: true })
    await region.focus()
    await expect(region).toBeFocused()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
    await page.keyboard.press('Tab')
    await expect(region.getByRole('button').first()).toBeFocused()
  })
}
