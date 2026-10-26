import { expect, test } from '@playwright/test'
import { readTestTarget } from '../../../support/test-target'
import { companyUsers, deferred, employeeNote, ExpenseUi } from '../expense-ui'

test.use({ baseURL: readTestTarget() })

for (const staleSection of ['directory', 'notes'] as const) {
  test(`HR: an obsolete ${staleSection} HTTP failure cannot replace a newer successful list`, async ({ page }) => {
    const releaseOldResponse = deferred()
    const oldRequestStarted = deferred()
    let delayedReads = 0
    const oldPath = staleSection === 'directory' ? '/api/hr/users' : '/api/hr/expense-notes'
    const users = Array.from({ length: 25 }, (_, index) => index < companyUsers.length ? companyUsers[index] : {
      ...companyUsers[0], id: `00000000-0000-4000-8000-${String(index + 501).padStart(12, '0')}`,
      name: `Employee ${index + 1}`, email: `employee${index + 1}@example.test`,
    })
    const notes = Array.from({ length: 25 }, (_, index) => ({
      ...employeeNote, id: `00000000-0000-4000-8000-${String(index + 601).padStart(12, '0')}`,
      description: `Note concurrente ${index + 1}`,
    }))

    await page.route('**/api/hr/users*', async route => {
      const url = new URL(route.request().url())
      const isDirectory = !url.searchParams.has('role') && !url.searchParams.has('selectedManagerId')
      if (isDirectory && staleSection === 'directory' && ++delayedReads === 1) {
        oldRequestStarted.release()
        await releaseOldResponse.promise
        return route.fulfill({ status: 503, json: {} })
      }
      const currentPage = Number(url.searchParams.get('page'))
      return route.fulfill({ json: {
        items: isDirectory ? users.slice((currentPage - 1) * 20, currentPage * 20) : companyUsers.filter(user => user.role === 'manager'),
        pagination: { page: currentPage, pageSize: 20, totalItems: isDirectory ? 25 : 1 },
        totals: { count: isDirectory ? 25 : 1, scope: 'filtered' },
      } })
    })
    await page.route('**/api/hr/expense-notes*', async route => {
      if (staleSection === 'notes' && ++delayedReads === 1) {
        oldRequestStarted.release()
        await releaseOldResponse.promise
        return route.fulfill({ status: 503, json: {} })
      }
      const currentPage = Number(new URL(route.request().url()).searchParams.get('page'))
      return route.fulfill({ json: {
        items: notes.slice((currentPage - 1) * 20, currentPage * 20),
        pagination: { page: currentPage, pageSize: 20, totalItems: 25 },
        totals: { count: 25, amount: 308.5, scope: 'filtered' },
      } })
    })

    await new ExpenseUi(page).signIn('HR', '/hr')
    await oldRequestStarted.promise
    // Paging either RH section refreshes both lists. Keep the first request of
    // the other section in flight until its replacement has already rendered.
    const trigger = staleSection === 'directory' ? 'Pagination des notes RH en attente' : 'Pagination de l’annuaire'
    await page.getByRole('navigation', { name: trigger, exact: true }).getByRole('button', { name: 'Suivant', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Organigramme (25)', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Notes des managers racine en attente (25)', exact: true })).toBeVisible()
    await expect.poll(() => delayedReads).toBe(2)

    const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname === oldPath && response.status() === 503)
    releaseOldResponse.release()
    await (await oldResponse).finished()
    // Observe after the browser has painted the released response, without an
    // arbitrary sleep or a third request that could clear a spurious alert.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
    await expect(page.getByText(staleSection === 'directory' ? 'Alice Test' : 'Employee 21', { exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: staleSection === 'directory' ? 'Note concurrente 21' : 'Note concurrente 1', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Réessayer/ })).toHaveCount(0)
  })
}
