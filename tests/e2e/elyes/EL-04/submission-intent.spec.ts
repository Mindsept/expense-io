import { expect, test } from '@playwright/test'
import { readTestTarget } from '../../../support/test-target'
import { employeeNote, ExpenseUi, pagedNotes } from '../expense-ui'

test.use({ baseURL: readTestTarget() })

test('a retry after a lost response reuses the same key, fields and receipt', async ({ page }) => {
  const posts: Array<{ key: string | undefined; body: string }> = []
  let historyReads = 0
  await page.route('**/api/expense-notes*', async route => {
    const request = route.request()
    if (request.method() === 'POST') {
      posts.push({ key: request.headers()['idempotency-key'], body: request.postData() ?? '' })
      if (posts.length === 1) return route.abort('failed')
      return route.fulfill({ status: 201, json: employeeNote, headers: { 'Idempotency-Replayed': 'true' } })
    }
    historyReads += 1
    return route.fulfill({ json: pagedNotes(historyReads === 1 ? [] : [employeeNote]) })
  })

  const ui = new ExpenseUi(page)
  await ui.signIn('EMPLOYEE')
  await ui.fillExpense()
  await page.getByRole('button', { name: 'Soumettre', exact: true }).click()
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Résultat non confirmé')
  await expect(page.getByRole('button', { name: 'Réessayer la même soumission', exact: true })).toBeEnabled()

  await page.getByRole('button', { name: 'Réessayer la même soumission', exact: true }).click()
  await expect(page.getByText('Note de frais enregistrée.', { exact: true })).toBeVisible()
  expect(posts).toHaveLength(2)
  expect(posts[0].key).toMatch(/^[0-9a-f-]{36}$/i)
  expect(posts[1].key).toBe(posts[0].key)
  expect(posts[1].body).toContain('Nouvelle note de recette')
  expect(posts[1].body).toContain('2026-10-16')
  expect(posts[1].body).toContain('receipt.png')
  await expect(page.getByLabel('Montant (€)', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Reçu (image ou PDF)', { exact: true })).toHaveValue('')
})

test('a changed uncertain form cannot silently create a new intent', async ({ page }) => {
  let posts = 0
  await page.route('**/api/expense-notes*', async route => {
    if (route.request().method() === 'POST') {
      posts += 1
      if (posts === 1) return route.abort('failed')
      return route.fulfill({ status: 201, json: employeeNote })
    }
    return route.fulfill({ json: pagedNotes([]) })
  })

  const ui = new ExpenseUi(page)
  await ui.signIn('EMPLOYEE')
  await ui.fillExpense()
  await page.getByRole('button', { name: 'Soumettre', exact: true }).click()
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Résultat non confirmé')
  await page.getByLabel('Description', { exact: true }).fill('Description modifiée')
  await page.getByRole('button', { name: 'Réessayer la même soumission', exact: true }).click()
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Le formulaire a changé')
  expect(posts).toBe(1)

  await page.getByRole('button', { name: 'J’ai vérifié l’historique, abandonner cette tentative', exact: true }).click()
  await page.getByRole('button', { name: 'Soumettre', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: /^Note de frais enregistrée\.$/ })).toHaveText('Note de frais enregistrée.')
  expect(posts).toBe(2)
})

test('after a reload, the old file is not restored and history must be checked first', async ({ page }) => {
  const keys: string[] = []
  let posts = 0
  await page.route('**/api/expense-notes*', async route => {
    if (route.request().method() === 'POST') {
      posts += 1
      keys.push(route.request().headers()['idempotency-key'])
      if (posts === 1) return route.abort('failed')
      return route.fulfill({ status: 201, json: employeeNote })
    }
    return route.fulfill({ json: pagedNotes([]) })
  })

  const ui = new ExpenseUi(page)
  await ui.signIn('EMPLOYEE')
  await ui.fillExpense()
  await page.getByRole('button', { name: 'Soumettre', exact: true }).click()
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Résultat non confirmé')
  await page.reload()
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Son reçu ne peut pas être restauré')
  await expect(page.getByRole('button', { name: 'Soumettre', exact: true })).toBeDisabled()
  await expect(page.getByLabel('Reçu (image ou PDF)', { exact: true })).toHaveValue('')

  await page.getByRole('button', { name: 'J’ai vérifié l’historique, continuer', exact: true }).click()
  await ui.fillExpense()
  await page.getByRole('button', { name: 'Soumettre', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: /^Note de frais enregistrée\.$/ })).toHaveText('Note de frais enregistrée.')
  expect(keys).toHaveLength(2)
  expect(keys[0]).not.toBe(keys[1])
})
