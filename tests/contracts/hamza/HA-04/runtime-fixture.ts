import { setTimeout as delay } from 'node:timers/promises'
import { randomUUID, randomBytes } from 'node:crypto'
import { Pool } from 'pg'
import { runner } from 'node-pg-migrate'
import { provisionRuntime } from '../../../../scripts/rls/provision-runtime.mjs'
import { enrollmentFixture } from '../HA-05/live-fixture'

/** Own a random new test DB; never provision roles in the personal DB/cluster. */
export async function runtimeFixture(port = 3137) {
  const value = process.env.HA04_TEST_ADMIN_DATABASE_URL
  if (!value || process.env.ARLA_TEST_ENV!=='isolated' || !/^arla-ci-[0-9a-f]{12}$/.test(process.env.ARLA_TEST_PROJECT || '')) throw new Error('Use the explicit isolated HA-04 CI fixture.')
  const template = new URL(value)
  if (!['127.0.0.1','localhost'].includes(template.hostname) || !template.pathname.endsWith('_test')) throw new Error('Refusing non-loopback/non-test administrator database.')
  const cluster = new Pool({connectionString:value,max:1})
  const name = `ha04_runtime_${randomUUID().replaceAll('-','')}_test`
  let created = false, fixture: Awaited<ReturnType<typeof enrollmentFixture>> | undefined
  let admin: Pool | undefined, runtime: Pool | undefined
  let closing = false
  async function close() {
    if (closing) return
    closing = true
    try {
      await fixture?.close(); await runtime?.end(); await admin?.end()
      if (created) {
        // Migration/client shutdown can outlive its JS completion on Linux.
        // Wait for owned connections to disappear; never force-kill an idle pg
        // client and turn its pending shutdown into an unhandled FATAL event.
        const deadline=Date.now()+5000
        let remaining=1
        while (Date.now()<deadline) {
          remaining=Number((await cluster.query("SELECT count(*) FROM pg_stat_activity WHERE datname=$1 AND backend_type='client backend'",[name])).rows[0].count)
          if (!remaining) break
          await delay(100)
        }
        if (remaining) throw new Error('Owned runtime test database still has active clients after orderly shutdown.')
        await cluster.query(`DROP DATABASE ${name}`)
      }
    } finally { await cluster.end() }
  }

  try {
    await cluster.query(`CREATE DATABASE ${name}`); created = true
    const url = new URL(template); url.pathname=`/${name}`
    const quiet = () => {}
    await runner({databaseUrl:url.href,dir:'migrations',migrationsTable:'pgmigrations',direction:'up',checkOrder:true,singleTransaction:true,logger:{debug:quiet,info:quiet,warn:quiet,error:quiet}})
    admin = new Pool({connectionString:url.href,max:5})
    const password = randomBytes(32).toString('base64url')
    await provisionRuntime(admin,password)
    const limited = new URL(url); limited.username='expense_web'; limited.password=password
    runtime = new Pool({connectionString:limited.href,max:1})
    fixture = await enrollmentFixture({adminDatabaseURL:url.href,runtimeDatabaseURL:limited.href,port,retainFixtureRows:true})
    return {...fixture,admin,runtime,adminURL:url.href,runtimeURL:limited.href,close}
  } catch (error) { await close(); throw error }
}
