import { readFileSync, lstatSync } from 'node:fs'
import path from 'node:path'
import { Pool } from 'pg'
import { S3Client } from '@aws-sdk/client-s3'
import { DemoSeedError, demoSettings } from './settings.mjs'
import { ensureDemoBucket } from './storage.mjs'

export async function demoCli(operation, args=process.argv.slice(2)) {
  let pool,s3
  try {
    let input=process.env
    if(args.length) {
      if(args.length!==2 || args[0]!=='--config' || !path.isAbsolute(args[1])) throw new DemoSeedError('absolute_private_config_required')
      const file=lstatSync(args[1])
      if(!file.isFile() || file.isSymbolicLink() || (process.platform!=='win32' && (file.mode&0o077))) throw new DemoSeedError('private_config_permissions')
      input=JSON.parse(readFileSync(args[1],'utf8'))
    }
    const settings=demoSettings(input)
    s3=new S3Client({endpoint:settings.endpoint,region:settings.region,forcePathStyle:true,maxAttempts:1,credentials:{accessKeyId:settings.accessKeyId,secretAccessKey:settings.secretAccessKey}})
    if(operation==='bucket') {console.info(JSON.stringify(await ensureDemoBucket(settings,s3)));return}
    const {runDemoSeed}=await(await import('./load.mjs')).seedImplementation()
    pool=new Pool({connectionString:settings.databaseURL,max:1,connectionTimeoutMillis:3000,statement_timeout:5000,query_timeout:6000})
    console.info(JSON.stringify(await runDemoSeed(settings,{pool,s3,mode:operation})))
  } catch(error) {
    console.error(error instanceof DemoSeedError?error.message:'Demo preparation failed; check the private maintenance configuration and services. No driver details or credentials are printed.')
    process.exitCode=1
  } finally {await pool?.end();s3?.destroy()}
}
