import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { parseEnv } from 'node:util'
const io = vi.hoisted(() => ({ open: vi.fn(), stat: vi.fn(), read: vi.fn(), write: vi.fn(), rename: vi.fn(), unlink: vi.fn(), close: vi.fn() }))
vi.mock('node:fs', () => ({ openSync: io.open, lstatSync: io.stat, readFileSync: io.read, writeFileSync: io.write, renameSync: io.rename, unlinkSync: io.unlink, closeSync: io.close }))
const originalArgv = process.argv, originalExit = process.exitCode
beforeEach(() => {
  vi.resetAllMocks(); vi.resetModules(); process.argv = [process.execPath, 'generate-auth-secret.mjs']; process.exitCode = 0
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {})
  io.open.mockReturnValueOnce(10).mockReturnValue(11); io.stat.mockReturnValue({ isFile: () => true }); io.read.mockReturnValue('OTHER=value\n')
})
afterEach(() => { process.argv = originalArgv; process.exitCode = originalExit; vi.restoreAllMocks() })
it.each(['missing', 'existing', 'placeholder', 'no-newline'])('provisions a private secret while preserving unrelated settings: %s', async mode => {
  if (mode === 'missing') io.stat.mockImplementation(() => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) })
  if (mode === 'placeholder') io.read.mockReturnValue('OTHER=value\nAUTH_SECRET=change-me\n')
  if (mode === 'no-newline') io.read.mockReturnValue('OTHER=value')
  await import('../../../scripts/generate-auth-secret.mjs')
  expect(process.exitCode).toBe(0)
  const written = String(io.write.mock.calls[0][1]), env = parseEnv(written)
  expect(env.AUTH_SECRET).toEqual(expect.any(String))
  expect(Buffer.from(env.AUTH_SECRET!, 'base64url')).toHaveLength(32)
  if (mode !== 'missing') expect(env.OTHER).toBe('value')
  expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(env.AUTH_SECRET)
  expect(io.rename).toHaveBeenCalledOnce(); expect(io.close).toHaveBeenCalledWith(10); expect(io.close).toHaveBeenCalledWith(11)
})
it('preserves an already valid secret without writing or printing it', async () => {
  const secret = Buffer.alloc(32, 2).toString('base64url'); io.read.mockReturnValue(`AUTH_SECRET=${secret}\n`)
  await import('../../../scripts/generate-auth-secret.mjs')
  expect(process.exitCode).toBe(0); expect(io.write).not.toHaveBeenCalled(); expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(secret)
})
it.each(['arguments', 'not-file', 'multiple', 'locked', 'write', 'short'])('refuses unsafe provisioning: %s', async fault => {
  if (fault === 'arguments') process.argv.push('one', 'two')
  if (fault === 'not-file') io.stat.mockReturnValue({ isFile: () => false })
  if (fault === 'multiple') io.read.mockReturnValue('AUTH_SECRET=one\nAUTH_SECRET=two\n')
  if (fault === 'locked') io.open.mockImplementation(() => { throw new Error('private path and secret') })
  if (fault === 'write') io.write.mockImplementation(() => { throw new Error('private secret') })
  if (fault === 'short') io.read.mockReturnValue('AUTH_SECRET=short\n')
  await import('../../../scripts/generate-auth-secret.mjs')
  expect(process.exitCode).toBe(1); expect(io.rename).not.toHaveBeenCalled()
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private path and secret')
})
