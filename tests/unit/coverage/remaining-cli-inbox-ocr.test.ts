import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'

const io = vi.hoisted(() => ({ createServer: vi.fn(), recognize: vi.fn(), createWorker: vi.fn(), listen: vi.fn(), close: vi.fn(), closeAllConnections: vi.fn(), on: vi.fn() }))
vi.mock('node:http', () => ({ createServer: io.createServer }))
vi.mock('tesseract.js', () => ({ createWorker: io.createWorker }))
const initialArgv = process.argv, initialExit = process.exitCode
const signals = new Map<string | symbol, (...args: unknown[]) => unknown>()
const origin = 'http://127.0.0.1:3210', bearer = 'private-test-bearer'.repeat(2)
const message = { type: 'expense-io.enrollment.v1', to: 'alice@company.test', link: `${origin}/signup#${'a'.repeat(43)}.${'b'.repeat(43)}`, expiresAt: '2030-01-01T00:00:00Z' }
beforeEach(() => {
  vi.resetAllMocks(); vi.resetModules(); signals.clear(); process.exitCode = 0
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(process, 'once').mockImplementation((event, listener) => { signals.set(event, listener); return process })
  io.listen.mockImplementation((_port, _host, callback) => callback())
  io.createServer.mockReturnValue({ listen: io.listen, on: io.on, close: io.close, closeAllConnections: io.closeAllConnections })
  io.createWorker.mockResolvedValue({ recognize: io.recognize }); io.recognize.mockResolvedValue({ data: { text: 'Total 18,75 €' } })
})
afterEach(() => { process.argv = initialArgv; process.exitCode = initialExit; vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

async function inbox() {
  const { createDemoInbox } = await import('../../../scripts/hamza/enrollment-demo-inbox.mjs')
  const server = createDemoInbox({ origin, bearer })
  return { server, request: async (method = 'POST', body: unknown = message, url = '/enrollment', authorization = `Bearer ${bearer}`) => {
    const response = { setHeader: vi.fn(), writeHead: vi.fn(), end: vi.fn() }; response.writeHead.mockReturnValue(response)
    const request = Object.assign(Readable.from([typeof body === 'string' ? body : JSON.stringify(body)]), { method, url, headers: { authorization } })
    await io.createServer.mock.calls[0][1](request, response)
    return response
  } }
}
it('accepts only synthetic invitations and exposes them only to the bearer owner', async () => {
  const { server, request } = await inbox()
  expect((await request()).writeHead).toHaveBeenCalledWith(202)
  const response = await request('GET')
  expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store')
  expect(JSON.parse(response.end.mock.calls[0][0])).toEqual([message]); expect(server.messages).toHaveLength(1)
  expect((await request('GET', '', '/enrollment', 'wrong')).writeHead).toHaveBeenCalledWith(403)
  expect((await request('GET', '', '/other')).writeHead).toHaveBeenCalledWith(404)
  expect((await request('DELETE')).writeHead).toHaveBeenCalledWith(405)
})
it.each([
  { type: 'wrong' }, { to: 'alice@example.com' }, { to: 123 }, { link: 'https://evil.test/signup#token' },
  { link: `${origin}/signup?secret=1#token` }, { link: `${origin}/other#token` }, { expiresAt: 'invalid' },
])('refuses invalid invitation payload $type $to $link $expiresAt', async patch => {
  const { server, request } = await inbox()
  expect((await request('POST', { ...message, ...patch })).writeHead).toHaveBeenCalledWith(400); expect(server.messages).toEqual([])
})
it('bounds malformed input, body size and retained messages', async () => {
  const { server, request } = await inbox()
  expect((await request('POST', '{')).writeHead).toHaveBeenCalledWith(400)
  expect((await request('POST', 'é'.repeat(4097))).writeHead).toHaveBeenCalledWith(413)
  for (let index = 0; index < 100; index++) await request()
  expect((await request()).writeHead).toHaveBeenCalledWith(503); expect(server.messages).toHaveLength(100)
})
it.each(['https://127.0.0.1:3210', 'http://example.test:3210', 'http://localhost', 'http://localhost:3000', `${origin}/other`, `${origin}/?q=1`, `${origin}/#token`, 'http://user:password@localhost:3210'])('rejects unsafe inbox origin %s', async unsafe => {
  const { createDemoInbox } = await import('../../../scripts/hamza/enrollment-demo-inbox.mjs')
  expect(() => createDemoInbox({ origin: unsafe, bearer })).toThrow('dedicated loopback'); expect(io.createServer).not.toHaveBeenCalled()
})
it.each(['short', 'a'.repeat(32) + '\n'])('requires a private well-formed bearer', async token => {
  const { createDemoInbox } = await import('../../../scripts/hamza/enrollment-demo-inbox.mjs')
  expect(() => createDemoInbox({ origin, bearer: token })).toThrow('private bearer')
})
function inboxEnv() {
  process.argv = [process.execPath, 'inbox.mjs', '--isolated']
  for (const [name, value] of Object.entries({ ENROLLMENT_DEMO_PORT: '3219', ARLA_TEST_ENV: 'isolated', AUTH_URL: origin, ENROLLMENT_DELIVERY_BEARER: bearer })) vi.stubEnv(name, value)
}
it('starts the inbox only on loopback and closes connections on either shutdown signal', async () => {
  inboxEnv(); await import('../../../scripts/hamza/enrollment-demo-inbox-cli.mjs')
  expect(io.listen).toHaveBeenCalledWith(3219, '127.0.0.1', expect.any(Function))
  signals.get('SIGINT')!(); signals.get('SIGTERM')!(); expect(io.close).toHaveBeenCalledTimes(2); expect(io.closeAllConnections).toHaveBeenCalledTimes(2)
  io.on.mock.calls[0][1](); expect(process.exitCode).toBe(1); expect(console.error).toHaveBeenCalledWith('Synthetic inbox could not start.')
})
it.each(['3000', '80', '65536', 'NaN'])('refuses unsafe inbox listening port %s', async port => {
  inboxEnv(); vi.stubEnv('ENROLLMENT_DEMO_PORT', port); await import('../../../scripts/hamza/enrollment-demo-inbox-cli.mjs')
  expect(process.exitCode).toBe(1); expect(io.listen).not.toHaveBeenCalled()
})
it('requires explicit isolated mode before opening the inbox', async () => {
  inboxEnv(); process.argv = [process.execPath, 'inbox.mjs']; await import('../../../scripts/hamza/enrollment-demo-inbox-cli.mjs')
  expect(process.exitCode).toBe(1); expect(io.createServer).not.toHaveBeenCalled()
})

async function ocr() {
  vi.spyOn(process, 'on').mockImplementation((event, listener) => { signals.set(event, listener); return process })
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never), send = vi.fn()
  vi.stubGlobal('process', Object.assign(Object.create(process), { send }))
  await import('../../../scripts/leandro/LE-05/ocr-worker.mjs')
  return { exit, send, receive: (data: unknown) => signals.get('message')!({ data }) }
}
it('reuses the OCR engine and returns bounded text and measured memory over IPC', async () => {
  const { receive, send } = await ocr()
  await receive(Buffer.from('first')); await receive(Buffer.from('second'))
  expect(io.createWorker).toHaveBeenCalledOnce(); expect(io.recognize).toHaveBeenCalledTimes(2)
  expect(send).toHaveBeenLastCalledWith({ kind: 'result', text: 'Total 18,75 €', memoryBytes: expect.any(Number) })
  const options = io.createWorker.mock.calls[0][2]; expect(options.cacheMethod).toBe('none'); options.logger(); options.errorHandler()
})
it.each(['invalid', 'oversized', 'failure'])('returns only a redacted OCR error for %s', async fault => {
  const { receive, send } = await ocr()
  if (fault === 'failure') io.recognize.mockRejectedValue(new Error('private source data'))
  else io.recognize.mockResolvedValue({ data: { text: fault === 'invalid' ? null : 'x'.repeat(131073) } })
  await receive(Buffer.from('image')); expect(send).toHaveBeenCalledWith({ kind: 'error' }); expect(JSON.stringify(send.mock.calls)).not.toContain('private source')
})
it('rejects malformed or concurrent OCR work and exits cleanly on IPC disconnection', async () => {
  const { receive, exit } = await ocr()
  await receive('not-a-buffer'); expect(exit).toHaveBeenCalledWith(1)
  let finish!: (value: { data: { text: string } }) => void
  io.recognize.mockReturnValue(new Promise(resolve => { finish = resolve }))
  const pending = receive(Buffer.from('first')); await Promise.resolve(); await receive(Buffer.from('second'))
  expect(exit).toHaveBeenCalledTimes(2); finish({ data: { text: 'ok' } }); await pending
  signals.get('disconnect')!(); expect(exit).toHaveBeenLastCalledWith(0)
})
