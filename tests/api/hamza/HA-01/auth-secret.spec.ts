import { randomBytes, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'
import { expect, request as http, test, type APIRequestContext } from '@playwright/test'

// This suite owns its server processes, not the shared Playwright webServer.
// MATH-01/02 supplies the migrated, explicitly disposable PostgreSQL target.
const mode = process.env.HA01_SERVER_MODE ?? 'production'
const port = Number(process.env.HA01_TEST_PORT ?? (mode === 'production' ? 3102 : 3101))
const baseURL = `http://127.0.0.1:${port}`

function testDatabase() {
  const value = process.env.HA01_TEST_DATABASE_URL
  if (!value) throw new Error('HA01_TEST_DATABASE_URL must name a migrated, disposable PostgreSQL database.')
  const url = new URL(value)
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !decodeURIComponent(url.pathname).endsWith('_test')
  ) throw new Error('HA-01 refuses a database outside loopback or without the _test suffix.')
  return value
}

async function stop(server: ChildProcess) {
  if (server.exitCode !== null || server.signalCode !== null) return
  const exited = once(server, 'exit')
  // Next dev may spawn a child; kill only this suite's private process group.
  process.kill(-server.pid!, 'SIGTERM')
  await Promise.race([exited, delay(5_000)])
  if (server.exitCode === null && server.signalCode === null) {
    process.kill(-server.pid!, 'SIGKILL')
    await exited
  }
}

async function start(secret: string, database: string, invalid = false) {
  if ((mode !== 'development' && mode !== 'production') || !Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('HA01_SERVER_MODE and HA01_TEST_PORT are invalid.')
  }
  // Refuse an existing listener: never accidentally test or stop another app.
  try {
    await fetch(`${baseURL}/api/auth/csrf`, { signal: AbortSignal.timeout(500) })
    throw new Error('HA-01 test port is already in use.')
  } catch (error) {
    if (error instanceof Error && error.message === 'HA-01 test port is already in use.') throw error
  }
  const server = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), mode === 'production' ? 'start' : 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    env: { ...process.env, NODE_ENV: mode, DATABASE_URL: database, AUTH_SECRET: secret, AUTH_TRUST_HOST: 'true', NEXT_TELEMETRY_DISABLED: '1' },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  // Do not publish raw server logs, which may contain upstream data. Retain only
  // the presence of our safe configuration diagnostic for rejection tests.
  let configurationRejected = false
  const inspect = (chunk: Buffer) => {
    if (chunk.toString().includes('Invalid AUTH_SECRET configuration.')) configurationRejected = true
  }
  server.stdout!.on('data', inspect)
  server.stderr!.on('data', inspect)
  const deadline = Date.now() + 60_000
  try {
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error('HA-01 test server exited before readiness.')
      try {
        const response = await fetch(`${baseURL}/api/auth/csrf`, { signal: AbortSignal.timeout(2_000) })
        if (response.ok || (invalid && response.status >= 500 && configurationRejected)) {
          return { server, configurationRejected: () => configurationRejected }
        }
      } catch { /* Server may still be starting or compiling. */ }
      await delay(200)
    }
    throw new Error('HA-01 test server did not become ready within 60 seconds.')
  } catch (error) {
    await stop(server)
    throw error
  }
}

async function login(client: APIRequestContext, email: string, password: string) {
  const csrf = await client.get('/api/auth/csrf')
  expect(csrf.status()).toBe(200)
  const { csrfToken } = await csrf.json()
  await client.post('/api/auth/callback/credentials', {
    form: { csrfToken, email, password, callbackUrl: `${baseURL}/expenses` },
    maxRedirects: 0,
  })
  return (await client.get('/api/auth/session')).json()
}

test('credentials work, sessions survive restart and are rejected after secret rotation', async () => {
  test.setTimeout(180_000)
  const database = testDatabase() // Guard before any fixture write.
  const pool = new Pool({ connectionString: database })
  const identity = randomUUID()
  const email = `ha01-${identity}@expense.test`
  const password = randomBytes(24).toString('base64url')
  const firstSecret = randomBytes(32).toString('base64url')
  const secondSecret = randomBytes(32).toString('base64url')
  let companyId: string | undefined
  let current: Awaited<ReturnType<typeof start>> | undefined
  const client = await http.newContext({ baseURL })
  const rejected = await http.newContext({ baseURL })
  try {
    const company = await pool.query('INSERT INTO companies (name, email_domain) VALUES ($1, $2) RETURNING id', ['HA-01 test', `${identity}.expense.test`])
    companyId = company.rows[0].id
    const user = await pool.query('INSERT INTO users (company_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id', [companyId, 'HA-01 test', email, await bcrypt.hash(password, 12), 'employee'])
    current = await start(firstSecret, database)
    expect(await login(rejected, email, 'incorrect-password')).toBeNull()
    const session = await login(client, email, password)
    expect(session.user.id).toBe(user.rows[0].id)
    expect(session.user.role).toBe('employee')
    expect((await client.get('/api/expense-notes')).status()).toBe(200)

    await stop(current.server)
    current = await start(firstSecret, database)
    expect((await (await client.get('/api/auth/session')).json()).user.id).toBe(user.rows[0].id)
    expect((await client.get('/api/expense-notes')).status()).toBe(200)

    await stop(current.server)
    current = await start(secondSecret, database)
    expect(await (await client.get('/api/auth/session')).json()).toBeNull()
    expect((await client.get('/api/expense-notes')).status()).toBe(401)
    expect((await login(client, email, password)).user.id).toBe(user.rows[0].id)
  } finally {
    if (current) await stop(current.server)
    await client.dispose()
    await rejected.dispose()
    if (companyId) {
      await pool.query('DELETE FROM users WHERE company_id = $1', [companyId])
      await pool.query('DELETE FROM companies WHERE id = $1', [companyId])
    }
    await pool.end()
  }
})

for (const [label, value] of [['empty', ''], ['public placeholder', 'changeme-generate-a-real-secret-for-non-local-use']]) {
  test(`rejects ${label} configuration at auth initialization`, async () => {
    test.setTimeout(90_000)
    const current = await start(value, testDatabase(), true)
    try {
      expect(current.configurationRejected()).toBe(true)
      expect((await fetch(`${baseURL}/api/auth/session`)).status).toBeGreaterThanOrEqual(500)
    } finally {
      await stop(current.server)
    }
  })
}
