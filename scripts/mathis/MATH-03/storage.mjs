import { createHash } from 'node:crypto'
import { HeadBucketCommand, CreateBucketCommand, HeadObjectCommand, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { setTimeout as delay } from 'node:timers/promises'
import { DemoSeedError, assertDemoSettings } from './settings.mjs'
export const DEMO_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
export const DEMO_HASH = createHash('sha256').update(DEMO_PNG).digest('hex')
export const absent = error => error?.$metadata?.httpStatusCode === 404
const status = error => error?.$metadata?.httpStatusCode
export async function sendDemo(s3, command, deadline = Date.now()+30_000) {
  for (let attempt=1; attempt<=3; attempt++) {
    if (Date.now() >= deadline) throw new DemoSeedError('storage_deadline')
    try { return await s3.send(command, { abortSignal: AbortSignal.timeout(Math.max(1, Math.min(3000, deadline-Date.now()))) }) }
    catch (error) {
      if (status(error)===403 || status(error)===401) throw new DemoSeedError('storage_access_denied')
      const retry = status(error)>=500 || ['TimeoutError','AbortError','RequestTimeout','ECONNREFUSED','ECONNRESET','ETIMEDOUT'].includes(error?.name) || ['ECONNREFUSED','ECONNRESET','ETIMEDOUT'].includes(error?.code)
      if (!retry) throw error
      if (attempt===3) throw new DemoSeedError('storage_unavailable')
      await delay(100*attempt)
    }
  }
}
export async function ensureDemoBucket(settings, s3) {
  assertDemoSettings(settings)
  const deadline=Date.now()+30_000
  try { await sendDemo(s3,new HeadBucketCommand({Bucket:settings.bucket}),deadline); return {bucket:'existing'} }
  catch (error) { if (!absent(error)) throw error }
  try { await sendDemo(s3,new CreateBucketCommand({Bucket:settings.bucket}),deadline) }
  catch (error) { if (!['BucketAlreadyOwnedByYou','BucketAlreadyExists'].includes(error?.name)) throw error }
  // A racing creation still needs an authenticated existence check.
  await sendDemo(s3,new HeadBucketCommand({Bucket:settings.bucket}),deadline)
  return {bucket:'ready'}
}
export async function checkDemoBucket(settings,s3,deadline) {
  try { await sendDemo(s3,new HeadBucketCommand({Bucket:settings.bucket}),deadline) }
  catch (error) { if (absent(error)) throw new DemoSeedError('bucket_missing_run_ensure_bucket'); throw error }
}
export async function healthyDemoObject(settings,s3,key,deadline) {
  let head
  try { head=await sendDemo(s3,new HeadObjectCommand({Bucket:settings.bucket,Key:key}),deadline) }
  catch (error) { if (absent(error)) return false; throw error }
  if (head.ContentLength!==DEMO_PNG.length || head.ContentType!=='image/png') throw new DemoSeedError('unexpected_demo_object')
  const object=await sendDemo(s3,new GetObjectCommand({Bucket:settings.bucket,Key:key}),deadline)
  if(!object.Body) throw new DemoSeedError('storage_payload_missing')
  const chunks=[];let size=0
  const timer=setTimeout(()=>object.Body?.destroy?.(new DemoSeedError('storage_deadline')),Math.max(1,Math.min(3000,(deadline??Date.now()+3000)-Date.now())))
  try {
    for await (const chunk of object.Body) { size+=chunk.length; if(size>DEMO_PNG.length) throw new DemoSeedError('unexpected_demo_object');chunks.push(chunk) }
  } finally { clearTimeout(timer);object.Body?.destroy?.() }
  if (createHash('sha256').update(Buffer.concat(chunks)).digest('hex')!==DEMO_HASH) throw new DemoSeedError('unexpected_demo_object')
  return true
}
export async function putDemoObject(settings,s3,key,deadline) {
  try { await sendDemo(s3,new PutObjectCommand({Bucket:settings.bucket,Key:key,Body:DEMO_PNG,ContentType:'image/png',IfNoneMatch:'*',Metadata:{'arla-demo':'math03-v1',sha256:DEMO_HASH}}),deadline) }
  catch (error) { if (status(error)!==412) throw error; if(!await healthyDemoObject(settings,s3,key,deadline)) throw new DemoSeedError('object_race') }
}
export async function removeDemoObject(settings,s3,key,deadline) { await sendDemo(s3,new DeleteObjectCommand({Bucket:settings.bucket,Key:key}),deadline) }
