import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { enrollmentFixture, type Mail } from '../../../contracts/hamza/HA-05/live-fixture'

let fixture: Awaited<ReturnType<typeof enrollmentFixture>>
test.beforeAll(async () => { fixture = await enrollmentFixture() })
test.afterAll(async () => { await fixture?.close() })

async function hrLogin(page: Page) {
  await page.goto(`${fixture.baseURL}/login`)
  await page.getByLabel('Email',{exact:true}).fill(fixture.hrEmail)
  await page.getByLabel('Mot de passe',{exact:true}).fill(fixture.password)
  await page.getByRole('button',{name:'Se connecter',exact:true}).click()
  await expect(page).toHaveURL(`${fixture.baseURL}/expenses`)
  await page.goto(`${fixture.baseURL}/hr/invitations`)
}
async function open(page: Page, mail: Mail) {
  await page.goto(`${fixture.baseURL}/signup`)
  await page.evaluate(fragment => { window.location.hash = fragment }, new URL(mail.link).hash)
  await page.getByRole('button',{name:'Ouvrir mon invitation',exact:true}).click()
  await expect(page).toHaveURL(`${fixture.baseURL}/signup`)
}

test('an HR sends a private address-bound invitation and its recipient creates an employee in that company', async ({ page, browser }) => {
  await hrLogin(page)
  const email = `${randomUUID()}@unrelated-domain.test`
  const before = fixture.messages.length
  await page.getByLabel('Adresse email à inviter').fill(email)
  await page.getByRole('button',{name:'Inviter',exact:true}).click()
  await expect(page.getByRole('status')).toContainText('Invitation confiée')
  expect(fixture.messages.length).toBe(before + 1)
  const mail = fixture.messages.at(-1)!
  expect(mail.to).toBe(email)
  const privateParts = new URL(mail.link).hash.slice(1).split('.')
  expect(privateParts).toHaveLength(2)
  const html = await page.content()
  for (const value of privateParts) expect(html.includes(value)).toBe(false)
  const context = await browser.newContext()
  try {
    const recipient = await context.newPage()
    await open(recipient, mail)
    await recipient.getByLabel('Nom',{exact:true}).fill('Invited colleague')
    await recipient.getByLabel('Mot de passe',{exact:true}).fill(randomBytes(24).toString('base64url'))
    await recipient.getByRole('button',{name:'Créer mon compte',exact:true}).click()
    await expect(recipient).toHaveURL(`${fixture.baseURL}/expenses`)
    const session = await (await context.request.get(`${fixture.baseURL}/api/auth/session`)).json()
    expect(session.user.email).toBe(email)
    expect(session.user.role).toBe('employee')
    const account = (await fixture.pool.query('SELECT id,company_id,role FROM users WHERE email=$1',[email])).rows
    expect(account).toHaveLength(1)
    expect(account[0].company_id).toBe(fixture.company)
    const invitation = (await fixture.pool.query('SELECT consumed_by,consumed_at,token_sha256,proof_sha256 FROM enrollment_invitations WHERE intended_email=$1',[email])).rows[0]
    expect(invitation.consumed_by).toBe(account[0].id)
    expect(invitation.consumed_at).toBeInstanceOf(Date)
    for (const value of privateParts) expect(JSON.stringify(invitation).includes(value)).toBe(false)
  } finally { await context.close() }
})

test('revocation from the HR screen invalidates the delivered link without creating an account', async ({ page, browser }) => {
  await hrLogin(page)
  const email = `${randomUUID()}@example.test`
  await page.getByLabel('Adresse email à inviter').fill(email)
  await page.getByRole('button',{name:'Inviter',exact:true}).click()
  await expect(page.getByRole('status')).toContainText('Invitation confiée')
  const mail = fixture.messages.at(-1)!
  await page.reload()
  const row = page.getByRole('listitem').filter({hasText:email})
  await row.getByRole('button',{name:'Révoquer',exact:true}).click()
  await expect(row.getByRole('status')).toHaveText('Invitation révoquée.')
  const context = await browser.newContext()
  try {
    const recipient = await context.newPage(); await open(recipient,mail)
    await recipient.getByLabel('Nom',{exact:true}).fill('Refused recipient')
    await recipient.getByLabel('Mot de passe',{exact:true}).fill(randomBytes(24).toString('base64url'))
    await recipient.getByRole('button',{name:'Créer mon compte',exact:true}).click()
    await expect(recipient.getByRole('alert').filter({hasText:'révoquée'})).toContainText('révoquée')
    expect((await fixture.pool.query('SELECT count(*)::int AS count FROM users WHERE email=$1',[email])).rows[0].count).toBe(0)
  } finally { await context.close() }
})

test('a failed delivery does not expose capabilities and leaves a revoked invitation', async ({ page }) => {
  await hrLogin(page)
  const email = `${randomUUID()}@example.test`
  const before = fixture.messages.length
  fixture.failDelivery(true)
  try {
    await page.getByLabel('Adresse email à inviter').fill(email)
    await page.getByRole('button',{name:'Inviter',exact:true}).click()
    await expect(page.getByRole('alert').filter({hasText:'Invitation non confirmée'})).toContainText('Invitation non confirmée')
    expect(fixture.messages.length).toBe(before)
    const rows = (await fixture.pool.query('SELECT revoked_at,consumed_at FROM enrollment_invitations WHERE intended_email=$1',[email])).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].revoked_at).toBeInstanceOf(Date)
    expect(rows[0].consumed_at).toBeNull()
  } finally { fixture.failDelivery(false) }
})
