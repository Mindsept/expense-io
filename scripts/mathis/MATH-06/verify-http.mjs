import { request } from '@playwright/test'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { lstat } from 'node:fs/promises'
import { spawnOwnedNodeProcess, stopOwnedNodeProcess } from '../../../tests/support/process-tree.mjs'
import { root, checkedDemo, refuse, sha256 } from './guards.mjs'
import { cleanEnvironment, command, vacant } from './services.mjs'

export function webEnvironment(config) {
  const env = { DATABASE_URL: config.webURL, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', AWS_EC2_METADATA_DISABLED: 'true' }
  for (const key of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_FORCE_PATH_STYLE', 'AUTH_SECRET', 'AUTH_URL', 'AUTH_TRUST_HOST', 'ARLA_TEST_ENV', 'ARLA_TEST_PROJECT']) env[key] = config.env[key]
  return cleanEnvironment(env)
}
export async function assertCleanAppConfiguration() {
  for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    const found = await lstat(path.join(root, name)).catch(error => { if (error.code !== 'ENOENT') throw error })
    if (found) refuse('use_clean_checkout_without_next_env_files')
  }
}
/** A real HTTP credentials session and consultation for each role, without changing business data. */
export async function verifyHttp(config, manifest) {
  await assertCleanAppConfiguration()
  const meta = checkedDemo(config), env = webEnvironment(config)
  if (!process.env.npm_execpath) refuse('run_restore_with_npm')
  await vacant(meta.appPort)
  await command(process.execPath, [process.env.npm_execpath, 'run', 'build'], env, 240000)
  const child = spawnOwnedNodeProcess([path.join(root, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(meta.appPort)], { cwd: root, env })
  child.stdout.resume(); child.stderr.resume()
  let spawnFailed = false
  child.once('error', () => { spawnFailed = true })
  const roles = [], receipts = new Set()
  try {
    let ready = false
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnFailed || child.exitCode !== null || child.signalCode !== null) break
      try { if ((await fetch(`${meta.baseUrl}/api/auth/csrf`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break } } catch {}
      await delay(200)
    }
    if (!ready) refuse('restricted_application_not_ready')
    for (const [key, role, route, page, heading] of [
      ['EMPLOYEE', 'employee', '/api/expense-notes', '/expenses', 'Mes notes de frais'],
      ['MANAGER', 'manager', '/api/manager/expense-notes', '/manager', 'Validation des notes de frais'],
      ['HR', 'hr_admin', '/api/hr/expense-notes', '/hr', 'Espace RH'],
    ]) {
      const context = await request.newContext({ baseURL: meta.baseUrl, timeout: 5000 })
      try {
        const csrfResponse = await context.get('/api/auth/csrf'), csrf = await csrfResponse.json(); await csrfResponse.dispose()
        const login = await context.post('/api/auth/callback/credentials', { form: { csrfToken: csrf.csrfToken, email: config.env[`ARLA_TEST_${key}_EMAIL`], password: config.env[`ARLA_TEST_${key}_PASSWORD`], callbackUrl: `${meta.baseUrl}/expenses` }, maxRedirects: 0 }); await login.dispose()
        const sessionResponse = await context.get('/api/auth/session'), session = await sessionResponse.json(); await sessionResponse.dispose()
        if (session.user?.role !== role || session.user?.email !== config.env[`ARLA_TEST_${key}_EMAIL`]) refuse('restored_role_authentication_failed')
        const html = await context.get(page)
        try { if (!html.ok() || !(await html.text()).includes(heading)) refuse('restored_role_page_failed') } finally { await html.dispose() }
        const listResponse = await context.get(route)
        let list
        try { if (!listResponse.ok()) refuse('restored_role_list_failed'); const body = await listResponse.json(); list = Array.isArray(body) ? body : body.items; if (!Array.isArray(list)) refuse('unexpected_restored_list') } finally { await listResponse.dispose() }
        const consultations = list.slice(0, 3).map(item => ({ item, route }))
        // A manager's own receipt remains consultable even after HR approved it;
        // validation queues alone are not a complete restored-history check.
        if (role === 'manager') {
          const ownResponse = await context.get('/api/expense-notes')
          try { if (!ownResponse.ok()) refuse('restored_own_list_failed'); const own = await ownResponse.json(); const items = Array.isArray(own) ? own : own.items; if (!Array.isArray(items)) refuse('unexpected_restored_list'); consultations.push(...items.slice(0, 3).map(item => ({ item, route: '/api/expense-notes' }))) } finally { await ownResponse.dispose() }
        }
        for (const { item, route: receiptRoute } of consultations) {
          const signedResponse = await context.get(`${receiptRoute}/${item.id}/receipt-url`)
          let signed
          try { if (!signedResponse.ok()) refuse('restored_receipt_authorization_failed'); signed = new URL((await signedResponse.json()).url) } finally { await signedResponse.dispose() }
          if (signed.origin !== config.env.S3_ENDPOINT || signed.username || signed.password || !signed.pathname.startsWith(`/${config.env.S3_BUCKET}/`)) refuse('unexpected_signed_receipt_target')
          const objectKey = decodeURIComponent(signed.pathname.slice(config.env.S3_BUCKET.length + 2))
          const expected = manifest.objects.find(object => object.key === objectKey)
          if (!expected) refuse('unknown_restored_receipt')
          const response = await context.get(signed.href)
          try { if (!response.ok() || sha256(await response.body()) !== expected.sha256) refuse('restored_receipt_http_integrity_failed') } finally { await response.dispose() }
          receipts.add(objectKey)
        }
        roles.push({ role, authenticated: true, page: 'ok', list: 'ok', notes: list.length })
      } finally { await context.dispose() }
    }
    if (receipts.size < 2) refuse('two_restored_receipts_must_be_consulted')
    return { roles, uniqueReceiptsRead: receipts.size, protocol: 'HTTP credentials sessions, server-rendered pages, authorized lists and signed receipt bytes; not a browser interaction test' }
  } finally { if (child.pid) await stopOwnedNodeProcess(child) }
}
