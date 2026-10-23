import { createDemoInbox } from '../../../../scripts/hamza/enrollment-demo-inbox.mjs'
import { createServer as createProbe } from 'node:net'
import { randomBytes, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'
import { spawnOwnedNodeProcess, stopOwnedNodeProcess } from '../../../support/process-tree.mjs'

export type Mail = { type: string; to: string; link: string; expiresAt: string }
export async function enrollmentFixture(options: {adminDatabaseURL?: string;runtimeDatabaseURL?: string;port?: number;retainFixtureRows?:boolean} = {}) {
  const url = options.adminDatabaseURL || process.env.HA05_TEST_DATABASE_URL
  if (!url) throw new Error('HA05_TEST_DATABASE_URL is required.')
  const target = new URL(url)
  if (!['postgres:', 'postgresql:'].includes(target.protocol) || !['127.0.0.1', 'localhost'].includes(target.hostname) || !target.pathname.endsWith('_test')) throw new Error('HA-05 refuses non-loopback/non-test databases.')
  const port = Number(options.port || process.env.HA05_TEST_PORT || 3135)
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535 || [3000,3199,3198].includes(port)) throw new Error('Dedicated HA-05 port required.')
  await new Promise<void>((done, reject) => { const probe = createProbe(); probe.once('error', reject); probe.listen(port, '127.0.0.1', () => probe.close(() => done())) })
  const baseURL = `http://127.0.0.1:${port}`
  const pool = new Pool({ connectionString: url })
  const company = randomUUID(), hr = randomUUID(), hrEmail = `${hr}@example.test`
  const password = randomBytes(24).toString('base64url'), bearer = randomBytes(32).toString('base64url')
  const inbox = createDemoInbox({origin:baseURL,bearer})
  // The real demo bridge is exercised; the test transport additionally records
  // synthetic messages in memory and can inject a provider outage.
  const messages = inbox.messages as Mail[]
  let refuseDelivery = false
  const bridge = (await import('node:http')).createServer((request,response) => {
    if (refuseDelivery && request.method === 'POST') { response.writeHead(503).end(); return }
    inbox.emit('request',request,response)

  })
  await new Promise<void>(done => bridge.listen(0, '127.0.0.1', done))
  const address = bridge.address()
  if (!address || typeof address === 'string') throw new Error('Private bridge not listening.')
  let server: ReturnType<typeof spawnOwnedNodeProcess> | undefined
  async function close() {
    if (server) await stopOwnedNodeProcess(server)
    bridge.closeAllConnections(); await new Promise<void>((done, reject) => bridge.close(error => error ? reject(error) : done()))
    if (!options.retainFixtureRows) {
    await pool.query('DELETE FROM enrollment_invitations WHERE company_id=$1', [company])
    await pool.query('DELETE FROM expense_notes WHERE user_id IN (SELECT id FROM users WHERE company_id=$1)', [company])
    await pool.query('DELETE FROM users WHERE company_id=$1', [company])
    await pool.query('DELETE FROM companies WHERE id=$1', [company])
    }
    await pool.end()
  }
  try {
    await pool.query('INSERT INTO companies(id,name,email_domain) VALUES($1,$2,$3)', [company,'HA05 live test',`${company}.test`])
    await pool.query("INSERT INTO users(id,company_id,name,email,password_hash,role) VALUES($1,$2,'HR',$3,$4,'hr_admin')", [hr,company,hrEmail,await bcrypt.hash(password,4)])
    const serverEnv = {...process.env}
    if (options.runtimeDatabaseURL) {
      for (const key of Object.keys(serverEnv)) if (/DATABASE_URL|POSTGRES_PASSWORD|POSTGRES_USER|POSTGRES_DB|SEED_/.test(key)) delete serverEnv[key]
    }
    server = spawnOwnedNodeProcess([resolve('node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)], { env: { ...serverEnv, NODE_ENV:'production', ARLA_TEST_ENV:'isolated', DATABASE_URL:options.runtimeDatabaseURL || url, AUTH_URL:baseURL, AUTH_SECRET:randomBytes(32).toString('base64url'), AUTH_TRUST_HOST:'true', NEXT_TELEMETRY_DISABLED:'1', ENROLLMENT_INVITATION_TTL_SECONDS:'3600', ENROLLMENT_DELIVERY_URL:`http://127.0.0.1:${address.port}/enrollment`, ENROLLMENT_DELIVERY_BEARER:bearer } })
    // Drain without retaining raw framework/provider logs or capabilities.
    server.stdout?.on('data', () => {}); server.stderr?.on('data', () => {})
    const deadline = Date.now() + 30_000
    let ready = false
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error('Owned enrollment server exited.')
      try { if ((await fetch(`${baseURL}/login`,{signal:AbortSignal.timeout(1000)})).ok) { ready = true; break } } catch { /* startup only */ }
      await delay(100)
    }
    if (!ready) throw new Error('Owned enrollment server not ready.')
    return { baseURL, pool, company, hr, hrEmail, password, messages, close, stopWeb: async () => { if (server) { await stopOwnedNodeProcess(server); server=undefined } }, failDelivery: (value: boolean) => { refuseDelivery = value } }
  } catch (error) { await close(); throw error }
}
