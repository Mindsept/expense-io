import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { expect,test,type Page } from '@playwright/test'
import { notificationFixture } from '../../../contracts/hamza/HA-09/runtime-fixture'

let fixture:Awaited<ReturnType<typeof notificationFixture>>
const owner=randomUUID(),manager=randomUUID(),replacement=randomUUID()
test.beforeAll(async()=>{
  fixture=await notificationFixture(3147)
  for(const[id,role]of [[owner,'employee'],[manager,'manager'],[replacement,'manager']])
    await fixture.admin.query('INSERT INTO users(id,company_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5,$6)',[id,fixture.company,role,`${id}@example.test`,await bcrypt.hash(fixture.password,4),role])
  await fixture.admin.query('UPDATE users SET manager_id=$1 WHERE id=$2',[manager,owner])
})
test.afterAll(async()=>{await fixture?.close()})
async function login(page:Page,id:string){
  await page.goto(`${fixture.baseURL}/login`)
  await page.getByLabel('Email',{exact:true}).fill(`${id}@example.test`)
  await page.getByLabel('Mot de passe',{exact:true}).fill(fixture.password)
  await page.getByRole('button',{name:'Se connecter',exact:true}).click()
  await expect(page).toHaveURL(`${fixture.baseURL}/expenses`)
}
async function pending(){
  return(await fixture.admin.query("INSERT INTO expense_notes(user_id,amount,expense_date,description,receipt_key) VALUES($1,12,'2026-10-23','Browser notification','fixture') RETURNING id",[owner])).rows[0].id
}

test('actual limited web page persists read state after worker delivery and hides reassigned work',async({page,browser})=>{
  await login(page,owner)
  await page.getByRole('link',{name:'Notifications',exact:true}).click()
  await expect(page.getByText('Aucune notification pour le moment.',{exact:true})).toBeVisible()
  const context=await browser.newContext()
  try{
    const reviewer=await context.newPage();await login(reviewer,manager)
    const expense=await pending()
    expect((await context.request.post(`${fixture.baseURL}/api/manager/expense-notes/${expense}/approve`)).status()).toBe(200)
    await page.reload()
    await expect(page.getByText('Aucune notification pour le moment.',{exact:true})).toBeVisible()
    await fixture.runWorker();await page.reload()
    await expect(page.getByText('Votre note a été acceptée.',{exact:true})).toBeVisible()
    await page.getByRole('button',{name:'Marquer comme lue',exact:true}).click()
    await expect(page.getByRole('button',{name:'Lue',exact:true})).toBeDisabled()
    const readAt=(await fixture.admin.query('SELECT read_at FROM decision_inbox WHERE expense_id=$1',[expense])).rows[0].read_at
    expect(readAt).toBeInstanceOf(Date)
    await page.reload()
    await expect(page.getByRole('button',{name:'Lue',exact:true})).toBeDisabled()
    expect((await fixture.admin.query('SELECT read_at FROM decision_inbox WHERE expense_id=$1',[expense])).rows[0].read_at).toEqual(readAt)

    await pending();await fixture.runWorker()
    await reviewer.goto(`${fixture.baseURL}/notifications`)
    await expect(reviewer.getByText('Une note attend votre validation.',{exact:true})).toBeVisible()
    await expect(reviewer.getByRole('link',{name:'Voir la file de validation',exact:true})).toHaveAttribute('href','/manager')
    await fixture.admin.query('UPDATE users SET manager_id=$1 WHERE id=$2',[replacement,owner])
    await reviewer.reload()
    await expect(reviewer.getByText('Aucune notification pour le moment.',{exact:true})).toBeVisible()
  }finally{await context.close()}
})

test('two notified HR see the first decision as processed and a later decision is refused',async({browser})=>{
  const hr=[randomUUID(),randomUUID()],employee=randomUUID()
  for(const[id,role]of [[employee,'employee'],...hr.map(id=>[id,'hr_admin'])])
    await fixture.admin.query('INSERT INTO users(id,company_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5,$6)',[id,fixture.company,role,`${id}@example.test`,await bcrypt.hash(fixture.password,4),role])
  const expense=(await fixture.admin.query("INSERT INTO expense_notes(user_id,amount,expense_date,description,receipt_key) VALUES($1,12,'2026-10-23','Shared HR validation','fixture') RETURNING id",[employee])).rows[0].id
  await fixture.runWorker()
  const contexts=await Promise.all(hr.map(()=>browser.newContext()))
  try{
    const pages=await Promise.all(contexts.map(context=>context.newPage()))
    for(let i=0;i<2;i++){
      await login(pages[i],hr[i]);await pages[i].goto(`${fixture.baseURL}/notifications`)
      await expect(pages[i].getByText('Une note attend votre validation.',{exact:true})).toBeVisible()
    }
    expect((await contexts[0].request.post(`${fixture.baseURL}/api/hr/expense-notes/${expense}/approve`)).status()).toBe(200)
    expect((await contexts[1].request.post(`${fixture.baseURL}/api/hr/expense-notes/${expense}/reject`)).status()).toBe(409)
    await pages[1].reload()
    await expect(pages[1].getByText('Cette note a déjà été acceptée.',{exact:true})).toBeVisible()
    await expect(pages[1].getByText('Une note attend votre validation.',{exact:true})).toHaveCount(0)
  }finally{await Promise.all(contexts.map(context=>context.close()))}
})
