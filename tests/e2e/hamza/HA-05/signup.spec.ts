import { expect, test } from '@playwright/test'
import { readTestTarget } from '../../../support/test-target'

test.use({ baseURL: readTestTarget() })

test('public signup explains the invitation requirement and preserves the existing-account login path', async ({ page }) => {
  await page.goto('/signup')
  await expect(page.getByRole('heading', { name: 'Inscription sur invitation', exact: true })).toBeVisible()
  await expect(page.getByText('Utilisez le lien reçu à votre adresse email', { exact: false })).toBeVisible()
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /inscrire|créer/i })).toHaveCount(0)
  await page.getByRole('link', { name: 'Se connecter', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Connexion', exact: true })).toBeVisible()
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Mot de passe', { exact: true })).toBeVisible()
})
