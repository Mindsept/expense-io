import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { expect, test } from '@playwright/test'
import { readTestIdentity, readTestTarget } from '../../../support/test-target'

const baseURL = readTestTarget()
const identity = readTestIdentity('EMPLOYEE')
const databaseURL = process.env.LE01_TEST_DATABASE_URL
const bucket = process.env.S3_BUCKET
if (!databaseURL || !bucket || process.env.LE01_TEST_BASE_URL !== baseURL) throw new Error('LE-01 browser tests require the common isolated environment and matching application URL.')
const database = new URL(databaseURL)
const storage = new URL(process.env.S3_ENDPOINT ?? '')
if (![database, storage].every(url => ['127.0.0.1', 'localhost'].includes(url.hostname)) ||
    !decodeURIComponent(database.pathname).endsWith('_test') || !bucket.endsWith('-test')) {
  throw new Error('LE-01 browser tests refuse non-local or non-test database/storage targets.')
}

const pool = new Pool({ connectionString: databaseURL })
const s3 = new S3Client({ endpoint: storage.href, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } })
const description = `LE-01 browser synthetic ${randomUUID()}`
test.use({ baseURL })

async function ownNotes() {
  return pool.query(`SELECT en.* FROM expense_notes en JOIN users u ON u.id = en.user_id
    WHERE u.email = $1 AND en.description = $2`, [identity.email, description])
}

test.afterAll(async () => {
  try {
    await pool.query(`DELETE FROM expense_submission_attempts esa
      USING expense_submission_operations eso, expense_notes en, users u
      WHERE esa.operation_id = eso.id AND eso.note_id = en.id
        AND en.user_id = u.id AND u.email = $1 AND en.description = $2`, [identity.email, description])
    await pool.query(`DELETE FROM expense_submission_operations eso
      USING expense_notes en, users u
      WHERE eso.note_id = en.id AND en.user_id = u.id AND u.email = $1 AND en.description = $2`, [identity.email, description])
    const notes = await pool.query(`DELETE FROM expense_notes en USING users u
      WHERE en.user_id = u.id AND u.email = $1 AND en.description = $2 RETURNING en.receipt_key`, [identity.email, description])
    for (const note of notes.rows) {
      if (note.receipt_key) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: note.receipt_key }))
    }
  } finally { await pool.end(); s3.destroy() }
})

test('real form preserves fields after a spoofed receipt rejection and accepts a corrected receipt', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(identity.email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(identity.password)
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
  await expect(page).toHaveURL(`${baseURL}/expenses`)

  const amount = page.getByLabel('Montant (€)', { exact: true })
  const date = page.getByLabel('Date', { exact: true })
  const details = page.getByLabel('Description', { exact: true })
  const receipt = page.getByLabel('Reçu (image ou PDF)', { exact: true })
  const submit = page.getByRole('button', { name: 'Soumettre', exact: true })
  const alert = page.getByRole('main').getByRole('alert')
  await amount.fill('12.34')
  await date.fill('2024-02-29')
  await details.fill(description)
  await receipt.setInputFiles({ name: 'spoofed.png', mimeType: 'image/png', buffer: Buffer.from('ordinary text') })
  expect((await ownNotes()).rows).toHaveLength(0)

  const rejected = page.waitForResponse(response => response.url() === `${baseURL}/api/expense-notes` && response.request().method() === 'POST')
  await submit.click()
  const rejection = await rejected
  expect(rejection.status()).toBe(400)
  const problem = await rejection.json()
  expect(problem).toEqual({
    type: 'urn:expense-io:problem:validation', title: 'Invalid request', status: 400,
    detail: 'Check the required fields and their format.', error: 'Check the required fields and their format.',
    requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
  })
  expect(problem.requestId).toBe(rejection.headers()['x-request-id'])
  await expect(alert).toHaveText(`${problem.detail} Référence : ${problem.requestId}.`)
  await expect(amount).toHaveValue('12.34')
  await expect(date).toHaveValue('2024-02-29')
  await expect(details).toHaveValue(description)
  await expect(submit).toBeEnabled()
  expect((await ownNotes()).rows).toHaveLength(0)

  const png = await readFile('tests/fixtures/leandro/LE-01/valid.png')
  await receipt.setInputFiles({ name: 'corrected.png', mimeType: 'image/png', buffer: png })
  const accepted = page.waitForResponse(response => response.url() === `${baseURL}/api/expense-notes` && response.request().method() === 'POST')
  await submit.click()
  const response = await accepted
  expect(response.status()).toBe(201)
  const note = await response.json()
  await expect(page.getByRole('status').filter({ hasText: 'Note de frais enregistrée.' })).toBeVisible()
  await expect(alert).toHaveCount(0)
  const row = page.getByRole('row').filter({ hasText: description })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('12,34')
  expect((await ownNotes()).rows).toHaveLength(1)
  const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: note.receiptKey }))
  expect(Buffer.from(await object.Body!.transformToByteArray())).toEqual(png)
})
