import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { Pool } from 'pg'
import { expect, test } from '@playwright/test'
import { readTestIdentity, readTestTarget } from '../../../support/test-target'
import { DiagnosticHarness } from '../../../contracts/leandro/LE-08/http-harness'

readTestTarget()
const identity = readTestIdentity('EMPLOYEE')
const endpoint = process.env.S3_ENDPOINT, databaseURL = process.env.DATABASE_URL
if (!endpoint || !databaseURL || !process.env.AUTH_SECRET || !new URL(databaseURL).pathname.endsWith('_test') ||
    ![endpoint, databaseURL].every(value => ['localhost','127.0.0.1'].includes(new URL(value).hostname))) throw new Error('LE-08 requires explicit isolated services')
const pool = new Pool({ connectionString: databaseURL })
const harness = new DiagnosticHarness(new URL(endpoint))
const description = `LE-08 browser ${randomUUID()}`
test.beforeAll(async () => { await harness.start(); harness.failPuts = true })
test.afterAll(async () => { await harness.stop(); await pool.end() })
test('the support reference visible after a real S3 failure retrieves its internal cause without leaking input', async ({ page }) => {
  await page.goto(`${harness.url}/login`)
  await page.getByLabel('Email', { exact: true }).fill(identity.email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(identity.password)
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
  await expect(page).toHaveURL(`${harness.url}/expenses`)
  await page.getByLabel('Montant (€)', { exact: true }).fill('12.50')
  await page.getByLabel('Date', { exact: true }).fill('2024-02-29')
  await page.getByLabel('Description', { exact: true }).fill(description)
  await page.getByLabel('Reçu (image ou PDF)', { exact: true }).setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: readFileSync('tests/fixtures/leandro/LE-01/valid.png') })
  const failed = page.waitForResponse(response => response.url() === `${harness.url}/api/expense-notes` && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Soumettre', exact: true }).click()
  const response = await failed
  expect(response.status()).toBe(500)
  // The client deliberately does not consume an untrusted 5xx body. Exercise
  // its actual header-to-screen path; API tests verify body/header coherence.
  const reference = response.headers()['x-request-id']
  expect(reference).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  expect(response.headers()['content-type']).toBe('application/problem+json')
  const alert = page.locator('main > p[role="alert"]')
  await expect(alert).toHaveText(`Une erreur serveur est survenue. Réessaie plus tard. Référence : ${reference}.`)
  const shown = (await alert.innerText()).match(/Référence : ([0-9a-f-]{36})\./)?.[1]
  expect(shown).toBe(reference)
  await expect(page.getByLabel('Montant (€)', { exact: true })).toHaveValue('12.50')
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2024-02-29')
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue(description)
  await expect(page.getByLabel('Reçu (image ou PDF)', { exact: true })).toHaveValue(/synthetic\.png$/)
  expect((await pool.query(`SELECT count(*)::int AS count FROM expense_notes n JOIN users u ON u.id=n.user_id WHERE u.email=$1 AND n.description=$2`, [identity.email, description])).rows[0].count).toBe(0)
  await expect.poll(() => harness.events.some(event => event.requestId === shown && event.operation === 'storage.upload')).toBe(true)
  const env = { ...process.env }; delete env.FORCE_COLOR
  const exported = spawnSync(process.execPath, ['scripts/leandro/LE-08/export.mjs', '--input', '-', '--request-id', shown!], { input: harness.exportLines(), env, encoding: 'utf8', timeout: 5000 })
  expect(exported.status).toBe(0); expect(exported.stderr).toBe('')
  const result = JSON.parse(exported.stdout)
  expect(result.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ operation: 'storage.upload', code: 'storage_upload_failed', requestId: shown }),
    expect.objectContaining({ operation: 'expense-notes.submit', code: 'http_5xx', requestId: shown }),
  ]))
  expect(exported.stdout).not.toContain(identity.email)
  expect(exported.stdout).not.toContain(identity.password)
  expect(exported.stdout).not.toContain(description)
  expect(exported.stdout).not.toMatch(/X-Amz-|password_hash|synthetic.png|cookie|SELECT |INSERT /)
})
