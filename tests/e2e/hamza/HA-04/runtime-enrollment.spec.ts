import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { runtimeFixture } from '../../../contracts/hamza/HA-04/runtime-fixture'

let fixture: Awaited<ReturnType<typeof runtimeFixture>>
test.beforeAll(async () => { fixture=await runtimeFixture(3139) })
test.afterAll(async () => { await fixture?.close() })

test('HR invitation and recipient enrollment/login work in the actual limited web process', async ({page,browser}) => {
  await page.goto(`${fixture.baseURL}/login`)
  await page.getByLabel('Email',{exact:true}).fill(fixture.hrEmail)
  await page.getByLabel('Mot de passe',{exact:true}).fill(fixture.password)
  await page.getByRole('button',{name:'Se connecter',exact:true}).click()
  await expect(page).toHaveURL(`${fixture.baseURL}/expenses`)
  await page.goto(`${fixture.baseURL}/hr`)
  await page.getByRole('link',{name:'Gérer les invitations',exact:true}).click()
  const email=`${randomUUID()}@recipient.test`
  await page.getByLabel('Adresse email à inviter').fill(email)
  await page.getByRole('button',{name:'Inviter',exact:true}).click()
  await expect(page.getByRole('status')).toContainText('Invitation confiée')
  await expect.poll(()=>fixture.messages.length).toBe(1)
  const mail=fixture.messages[0]
  expect(mail.to).toBe(email)
  const context=await browser.newContext()
  try {
    const recipient=await context.newPage()
    await recipient.goto(`${fixture.baseURL}/signup`)
    await recipient.evaluate(hash=>{window.location.hash=hash},new URL(mail.link).hash)
    await recipient.getByRole('button',{name:'Ouvrir mon invitation',exact:true}).click()
    await expect(recipient).toHaveURL(`${fixture.baseURL}/signup`)
    await recipient.getByLabel('Nom',{exact:true}).fill('Limited-role recipient')
    await recipient.getByLabel('Mot de passe',{exact:true}).fill(randomBytes(24).toString('base64url'))
    await recipient.getByRole('button',{name:'Créer mon compte',exact:true}).click()
    await expect(recipient).toHaveURL(`${fixture.baseURL}/expenses`)
    await expect(recipient.getByRole('heading',{name:'Mes notes de frais',exact:true})).toBeVisible()
    expect((await(await context.request.get(`${fixture.baseURL}/api/auth/session`)).json()).user.email).toBe(email)
    const identity=(await fixture.runtime.query('SELECT current_user AS role,session_user AS login,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0]
    expect(identity).toEqual({role:'expense_web',login:'expense_web',rolsuper:false,rolbypassrls:false})
    expect((await fixture.runtime.query('SELECT id FROM users')).rows).toEqual([])
    expect((await fixture.admin.query('SELECT company_id,role FROM users WHERE email=$1',[email])).rows).toEqual([{company_id:fixture.company,role:'employee'}])
  } finally { await context.close() }
})
