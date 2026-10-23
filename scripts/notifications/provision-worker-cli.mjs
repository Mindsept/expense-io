import { Pool } from 'pg'
import { provisionRuntime } from '../rls/provision-runtime.mjs'
try {
  if (process.argv.length!==3 || process.argv[2]!=='--apply' || !process.env.HA09_ADMIN_DATABASE_URL) throw Error('Explicit administrator operation required.')
  const chunks=[];let bytes=0
  for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>512)throw Error('Input too long.');chunks.push(chunk)}
  const pool=new Pool({connectionString:process.env.HA09_ADMIN_DATABASE_URL,max:1,connectionTimeoutMillis:5000})
  try{await provisionRuntime(pool,Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/,''),'expense_notifications')}finally{await pool.end()}
  console.log('Limited notification worker provisioned. Configure its private connection separately.')
}catch{console.error('Worker provisioning failed. Check the migration, separate administrator URL and private password input.');process.exitCode=1}
