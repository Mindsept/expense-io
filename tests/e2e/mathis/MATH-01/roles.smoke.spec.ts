import { expect, test } from '@playwright/test'
import { readTestIdentity, readTestTarget } from '../../../support/test-target'

const baseURL = readTestTarget()
const roles = [
  { name: 'employee', key: 'EMPLOYEE', role: 'employee', path: '/expenses', heading: 'Mes notes de frais' },
  { name: 'manager', key: 'MANAGER', role: 'manager', path: '/manager', heading: 'Validation des notes de frais' },
  { name: 'hr', key: 'HR', role: 'hr_admin', path: '/hr', heading: 'Espace RH' },
] as const
const accounts = roles.map(role => ({ ...role, ...readTestIdentity(role.key) }))

test.use({ baseURL })
test.setTimeout(30_000)

for (const account of accounts) {
  test(`${account.name} signs in through the form and opens the authorized screen`, async ({ page, context }) => {
    // Playwright's page fixture creates and disposes a new browser context per test.
    expect(await context.cookies()).toEqual([])
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Connexion', exact: true })).toBeVisible()
    await page.getByLabel('Email', { exact: true }).fill(account.email)
    await page.getByLabel('Mot de passe', { exact: true }).fill(account.password)
    await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
    await expect(page).toHaveURL(`${baseURL}/expenses`, { timeout: 10_000 })
    const session = await (await context.request.get('/api/auth/session')).json()
    expect(session.user?.email).toBe(account.email)
    expect(session.user?.role).toBe(account.role)
    const response = await page.goto(account.path)
    expect(response?.ok()).toBe(true)
    await expect(page.getByRole('heading', { name: account.heading, exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Accès réservé/ })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Connexion', exact: true })).toHaveCount(0)
  })
}
