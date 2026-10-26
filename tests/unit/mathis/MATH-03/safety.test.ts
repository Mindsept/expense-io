import { expect, test, vi } from 'vitest'
import { Readable } from 'node:stream'
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, linkSync, statSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeNewPrivateJson } from '../../../../scripts/mathis/MATH-03/private-files.mjs'
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3'
import { demoSettings, demoNote, selectDemoNote } from '../../../../scripts/mathis/MATH-03/settings.mjs'
import { ensureDemoBucket, healthyDemoObject, DEMO_PNG } from '../../../../scripts/mathis/MATH-03/storage.mjs'

const env={SEED_DEMO_ENV:'local-test',SEED_CONFIRM_DATABASE:'expense_io_test',SEED_ADMIN_DATABASE_URL:'postgres://expense_test:private-secret@127.0.0.1:55440/expense_io_test',S3_ENDPOINT:'http://127.0.0.1:45740',S3_BUCKET:'receipts-ci-test',S3_ACCESS_KEY_ID:'test',S3_SECRET_ACCESS_KEY:'test',SEED_HR_EMAIL:'hr@expense.test',SEED_MANAGER_EMAIL:'manager@expense.test',SEED_EMPLOYEE_EMAIL:'employee@expense.test'}
const settings=()=>demoSettings(env)
const client=()=>new S3Client({region:'us-east-1',credentials:{accessKeyId:'test',secretAccessKey:'test'}})
function mockSend(s3:S3Client) {
 const send=vi.fn<(command:unknown,options?:unknown)=>Promise<unknown>>()
 vi.spyOn(s3,'send').mockImplementation(send as S3Client['send'])
 return send
}

test.each([
 {SEED_ADMIN_DATABASE_URL:undefined,DATABASE_URL:env.SEED_ADMIN_DATABASE_URL},
 {SEED_DEMO_ENV:undefined}, {SEED_CONFIRM_DATABASE:'expense_io'},
 {SEED_ADMIN_DATABASE_URL:env.SEED_ADMIN_DATABASE_URL.replace('expense_io_test','expense_io')},
 {SEED_ADMIN_DATABASE_URL:env.SEED_ADMIN_DATABASE_URL.replace('127.0.0.1','remote.example.test')},
 {SEED_ADMIN_DATABASE_URL:env.SEED_ADMIN_DATABASE_URL.replace('expense_test:','expense_web:')},
 {S3_BUCKET:'receipts'}, {S3_ENDPOINT:'http://127.0.0.1:4567'},
 {SEED_EMPLOYEE_EMAIL:'employee@real.example.com'}, {SEED_EMPLOYEE_EMAIL:env.SEED_HR_EMAIL},
])('rejects unsafe or implicit demo configuration without disclosing it: %j', change=>{
 let message=''
 try{demoSettings({...env,...change})}catch(error){message=(error as Error).message}
 expect(message).toContain('Demo preparation refused')
 expect(message).not.toContain('private-secret')
 expect(message).not.toContain('postgres://')
})

test('requires a verified actor, exact marker, stable identifier and owned receipt key',()=>{
 const actor='11111111-1111-4111-a111-111111111111', expected=demoNote(actor,'EMPLOYEE')
 const row={id:expected.id,user_id:actor,description:expected.description,receipt_key:''}
 expect(selectDemoNote([row],actor,expected)).toEqual(row)
 expect(()=>selectDemoNote([row,row],actor,expected)).toThrow('ambiguous_demo_notes')
 for(const change of [{id:'another-note'},{user_id:'foreign'},{description:'Taxi aéroport'},{receipt_key:'real/receipt.png'}])
  expect(()=>selectDemoNote([{...row,...change}],actor,expected)).toThrow('unrecognised_demo_note')
})

test('403 never becomes bucket absence and never triggers bucket creation',async()=>{
 const s3=client(),send=mockSend(s3).mockRejectedValue({$metadata:{httpStatusCode:403}})
 try{await expect(ensureDemoBucket(settings(),s3)).rejects.toThrow('storage_access_denied');expect(send).toHaveBeenCalledOnce()}
 finally{s3.destroy()}
})
test('404 alone permits bucket creation and a final authenticated check',async()=>{
 const s3=client(),send=mockSend(s3).mockRejectedValueOnce({$metadata:{httpStatusCode:404}}).mockResolvedValue({})
 try{await expect(ensureDemoBucket(settings(),s3)).resolves.toEqual({bucket:'ready'});expect(send).toHaveBeenCalledTimes(3);expect(send.mock.calls[1][0]).toBeInstanceOf(CreateBucketCommand)}finally{s3.destroy()}
})
test('a bounded service outage fails after three attempts',async()=>{
 const s3=client(),send=mockSend(s3).mockRejectedValue({$metadata:{httpStatusCode:503}})
 try{await expect(ensureDemoBucket(settings(),s3)).rejects.toThrow('storage_unavailable');expect(send).toHaveBeenCalledTimes(3)}finally{s3.destroy()}
})
test('existing receipt content is checked, and a foreign/corrupt object is never overwritten',async()=>{
 const s3=client(),send=mockSend(s3)
 send.mockResolvedValueOnce({ContentLength:DEMO_PNG.length,ContentType:'image/png'}).mockResolvedValueOnce({Body:Readable.from([DEMO_PNG])})
 try{
  await expect(healthyDemoObject(settings(),s3,'receipts/known.png')).resolves.toBe(true)
  send.mockResolvedValueOnce({ContentLength:10,ContentType:'application/pdf'})
  await expect(healthyDemoObject(settings(),s3,'receipts/known.png')).rejects.toThrow('unexpected_demo_object')
  expect(send.mock.calls.every(([command])=>typeof command==='object' && command!==null && command.constructor.name!=='PutObjectCommand')).toBe(true)
 }finally{s3.destroy()}
})

test('403 on an object remains an authorization failure, never a repair candidate',async()=>{
 const s3=client(),send=mockSend(s3).mockRejectedValue({$metadata:{httpStatusCode:403}})
 try{await expect(healthyDemoObject(settings(),s3,'receipts/known.png')).rejects.toThrow('storage_access_denied');expect(send).toHaveBeenCalledOnce()}finally{s3.destroy()}
})

test('private JSON creation refuses existing files and aliases instead of overwriting their target',()=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'math03-private-')),target=path.join(directory,'existing.env'),alias=path.join(directory,'seed.json'),fresh=path.join(directory,'runtime.json')
 try{
  writeFileSync(target,'preserve-existing-content')
  if(process.platform==='win32')linkSync(target,alias);else symlinkSync(target,alias)
  expect(()=>writeNewPrivateJson(alias,{secret:'not-written'})).toThrow()
  expect(()=>writeNewPrivateJson(target,{secret:'not-written'})).toThrow()
  expect(readFileSync(target,'utf8')).toBe('preserve-existing-content')
  writeNewPrivateJson(fresh,{synthetic:true})
  expect(JSON.parse(readFileSync(fresh,'utf8'))).toEqual({synthetic:true})
  if(process.platform!=='win32')expect(statSync(fresh).mode&0o077).toBe(0)
 }finally{rmSync(directory,{recursive:true,force:true})}
})
