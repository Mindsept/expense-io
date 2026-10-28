import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { assertCleanAppConfiguration, verifyHttp } from '../../../scripts/mathis/MATH-06/verify-http.mjs'
import { newDemo, sha256 } from '../../../scripts/mathis/MATH-06/guards.mjs'
const io = vi.hoisted(() => ({ lstat: vi.fn(), spawn: vi.fn(), stop: vi.fn(), command: vi.fn(), vacant: vi.fn(), context: vi.fn(), get: vi.fn(), post: vi.fn(), dispose: vi.fn(), responseDispose: vi.fn() }))
vi.mock('node:fs/promises', async original => ({ ...await original<typeof import('node:fs/promises')>(), lstat: io.lstat }))
vi.mock('../../../scripts/mathis/MATH-06/services.mjs', () => ({ cleanEnvironment: (env: unknown) => env, command: io.command, vacant: io.vacant }))
vi.mock('../../../tests/support/process-tree.mjs', () => ({ spawnOwnedNodeProcess: io.spawn, stopOwnedNodeProcess: io.stop }))
vi.mock('@playwright/test', () => ({ request: { newContext: io.context } }))
vi.mock('node:timers/promises', () => ({ setTimeout: async () => {} }))
const config = newDemo({ app: 3215, auth: 3216, db: 55440, s3: 45740 })
const body = Buffer.from('synthetic-receipt'), manifest = { objects: [1, 2].map(i => ({ key: `receipts/${i}.png`, sha256: sha256(body) })) }
let fault = '', roleIndex = -1
beforeEach(() => {
  vi.resetAllMocks(); fault = ''; roleIndex = -1
  vi.stubEnv('npm_execpath', 'npm-cli.js'); vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })))
  io.lstat.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
  io.spawn.mockImplementation(() => Object.assign(new EventEmitter(), { pid: 123, exitCode: null, signalCode: null, stdout: Readable.from([]), stderr: Readable.from([]) }))
  io.context.mockImplementation(async () => { roleIndex++; return { get: io.get, post: io.post, dispose: io.dispose } })
  const res = (value: unknown, text = '', ok = true) => ({ json: async () => value, text: async () => text, ok: () => ok, body: async () => fault === 'bytes' ? Buffer.from('wrong') : body, dispose: io.responseDispose })
  io.post.mockImplementation(async () => res({}))
  io.get.mockImplementation(async (url: string) => {
    if (url.endsWith('/csrf')) return res({ csrfToken: 'test-csrf' })
    if (url.endsWith('/session')) return res({ user: { role: fault === 'role' ? 'foreign' : ['employee', 'manager', 'hr_admin'][roleIndex], email: ['employee', 'manager', 'hr'].map(r => `${r}@expense.test`)[roleIndex] } })
    if (['/expenses', '/manager', '/hr'].includes(url)) return res({}, ['Mes notes de frais', 'Validation des notes de frais', 'Espace RH'][roleIndex], fault !== 'page')
    if (url.startsWith('http')) return res({})
    if (url.endsWith('/receipt-url')) return res({ url: (fault === 'target' ? 'https://foreign.example.test' : config.env.S3_ENDPOINT) + `/receipts-ci-test/receipts/${fault === 'unknown' ? 99 : roleIndex === 0 ? 1 : 2}.png` }, '', fault !== 'receipt-access')
    return res(fault === 'invalid-list' ? {} : { items: fault === 'empty' ? [] : [{ id: `note-${roleIndex}` }] }, '', fault !== 'list')
  })
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
it('verifies every restored role, own history and two receipts before returning proof', async () => {
  const result = await verifyHttp(config, manifest)
  expect(result.uniqueReceiptsRead).toBe(2)
  expect(result.roles.map((r: { role: string }) => r.role)).toEqual(['employee', 'manager', 'hr_admin'])
  expect(io.dispose).toHaveBeenCalledTimes(3); expect(io.stop).toHaveBeenCalledOnce()
  expect(io.post.mock.calls.every(([, options]) => options.form.password && options.maxRedirects === 0)).toBe(true)
})
it.each(['role', 'page', 'list', 'invalid-list', 'target', 'unknown', 'receipt-access', 'bytes', 'empty'])('refuses restoration proof for %s failure and cleans up', async failure => {
  fault = failure
  await expect(verifyHttp(config, manifest)).rejects.toThrow('MATH-06')
  expect(io.stop).toHaveBeenCalledOnce(); expect(io.dispose).toHaveBeenCalled()
})
it('refuses to read developer environment files', async () => {
  io.lstat.mockResolvedValue({})
  await expect(assertCleanAppConfiguration()).rejects.toThrow('use_clean_checkout_without_next_env_files')
})
it('does not hide filesystem errors as missing configuration', async () => {
  io.lstat.mockRejectedValue(new Error('permission denied'))
  await expect(assertCleanAppConfiguration()).rejects.toThrow('permission denied')
})
it('requires the documented npm entrypoint', async () => {
  vi.stubEnv('npm_execpath', '')
  await expect(verifyHttp(config, manifest)).rejects.toThrow('run_restore_with_npm'); expect(io.spawn).not.toHaveBeenCalled()
})
it('stops a server that fails before readiness', async () => {
  io.spawn.mockImplementation(() => Object.assign(new EventEmitter(), { pid: 123, exitCode: 1, signalCode: null, stdout: Readable.from([]), stderr: Readable.from([]) }))
  await expect(verifyHttp(config, manifest)).rejects.toThrow('restricted_application_not_ready'); expect(io.stop).toHaveBeenCalledOnce()
})
