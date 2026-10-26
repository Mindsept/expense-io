import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { request, type APIResponse } from '@playwright/test'
import { afterEach, expect, test, vi } from 'vitest'
import { measureListRequest, withRequestContext } from '../../../../scripts/mathis/MATH-05/http.mjs'

afterEach(() => vi.restoreAllMocks())

test.each([
  { status: 200, body: '[{"id":1}]', expected: 1, ok: true, error: null },
  { status: 200, body: '[]', expected: 1, ok: false, error: 'unexpected-row-count' },
  { status: 401, body: '{"error":"Unauthorized"}', expected: 0, ok: false, error: 'http-error' },
  { status: 200, body: 'invalid JSON', expected: 1, ok: false, error: 'request-error' },
])('releases the response for status $status and error $error', async row => {
  const response = { status: () => row.status, body: async () => Buffer.from(row.body), dispose: vi.fn(async () => {}) }
  const result = await measureListRequest({ get: async () => response }, { route: '/list', expected: row.expected })
  expect(result).toMatchObject({ status: row.status, bytes: Buffer.byteLength(row.body), ok: row.ok, error: row.error })
  expect(response.dispose).toHaveBeenCalledOnce()
})

test('releases a response whose body cannot be read', async () => {
  const response = { status: () => 200, body: async () => { throw new Error('stream failed') }, dispose: vi.fn(async () => {}) }
  expect(await measureListRequest({ get: async () => response }, { route: '/list', expected: 1 }))
    .toMatchObject({ status: 200, bytes: 0, ok: false, error: 'request-error' })
  expect(response.dispose).toHaveBeenCalledOnce()
})

test('retains timeouts without a response in the measured sample', async () => {
  const failure = Object.assign(new Error('timeout'), { name: 'TimeoutError' })
  const result = await measureListRequest({ get: async () => { throw failure } }, { route: '/list', expected: 1 })
  expect(result).toMatchObject({ status: null, bytes: 0, ok: false, error: 'timeout' })
  expect(result.ms).toBeGreaterThanOrEqual(0)
})

test('records latency before cleanup and retains a cleanup failure', async () => {
  let now = 10
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const response = {
    status: () => 200,
    body: async () => { now = 25; return Buffer.from('[]') },
    dispose: async () => { now = 1025; throw new Error('cleanup failed') },
  }
  expect(await measureListRequest({ get: async () => response }, { route: '/list', expected: 0 }))
    .toEqual({ status: 200, bytes: 2, ms: 15, ok: false, error: 'response-cleanup-error' })
})

test.each([false, true])('closes the context at the end of a scenario, failing=%s', async failing => {
  const client = { dispose: vi.fn(async () => {}) }
  const result = withRequestContext(async () => client, async active => {
    expect(active).toBe(client)
    expect(client.dispose).not.toHaveBeenCalled()
    if (failing) throw new Error('authentication failed')
    return 'complete'
  })
  if (failing) await expect(result).rejects.toThrow('authentication failed')
  else await expect(result).resolves.toBe('complete')
  expect(client.dispose).toHaveBeenCalledOnce()
})

test('a real Playwright response is already disposed when measurement returns', async () => {
  const server = createServer((_incoming, outgoing) => {
    outgoing.setHeader('Content-Type', 'application/json')
    outgoing.end('[{"id":1}]')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address() as AddressInfo
    await withRequestContext(() => request.newContext({ baseURL: `http://127.0.0.1:${port}` }), async client => {
      const responses: APIResponse[] = []
      const tracked = { get: async (url: string, options: { timeout: number }) => {
        const response = await client.get(url, options)
        responses.push(response)
        return response
      } }
      expect(await measureListRequest(tracked, { route: '/list', expected: 1 })).toMatchObject({ status: 200, ok: true })
      await expect(responses[0].body()).rejects.toThrow(/disposed/i)
    })
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

const pageBody=(change:Record<string,unknown>={})=>JSON.stringify({items:[{id:'one'}],pagination:{page:1,pageSize:100,totalItems:1},totals:{amount:12.34,count:1,scope:'filtered'},...change})
test.each([
 {body:pageBody(),ok:true},
 {body:'[{"id":"one"}]',ok:false},
 {body:pageBody({pagination:{page:1,pageSize:100,totalItems:2}}),ok:false},
 {body:pageBody({pagination:{page:2,pageSize:100,totalItems:1}}),ok:false},
 {body:pageBody({items:[]}),ok:false},
 {body:pageBody({totals:{amount:12.34,count:2,scope:'filtered'}}),ok:false},
])('validates bounded rows and exact authorized totals, accepted=$ok',async({body,ok})=>{
 const response={status:()=>200,body:async()=>Buffer.from(body),dispose:vi.fn(async()=>{})}
 expect(await measureListRequest({get:async()=>response},{route:'/list?page=1&pageSize=100',expected:1,pageSize:100})).toMatchObject({ok,error:ok?null:'unexpected-pagination'})
 expect(response.dispose).toHaveBeenCalledOnce()
})
