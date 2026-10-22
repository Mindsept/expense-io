import { expect, test } from '@playwright/test'
import { readTestTarget } from '../../../support/test-target'
import { employeeNote, ExpenseUi } from '../expense-ui'

for (const timezoneId of ['Europe/Paris', 'America/New_York']) {
  test.describe(timezoneId, () => {
    test.use({ baseURL: readTestTarget(), timezoneId })

    test('civil dates keep their day and repeated receipt actions identify their note', async ({ page }) => {
      await page.route('**/api/expense-notes', route => route.fulfill({ json: [
        employeeNote,
        { ...employeeNote, id: 'invalid-date', description: 'Date mal formée', expenseDate: '2026-02-31' },
      ] }))
      await new ExpenseUi(page).signIn('EMPLOYEE')
      await expect(page.getByRole('cell', { name: '16 oct. 2026', exact: true })).toBeVisible()
      await expect(page.getByRole('cell', { name: 'Date indisponible', exact: true })).toBeVisible()
      const receipt = page.getByRole('button', { name: 'Voir le reçu pour Taxi de recette, 16 oct. 2026', exact: true })
      await expect(receipt).toBeVisible()
      await receipt.focus()
      await expect(receipt).toBeFocused()
      await expect(page.getByRole('button', { name: 'Voir le reçu pour Date mal formée, Date indisponible', exact: true })).toBeVisible()
    })
  })
}
