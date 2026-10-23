import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/errors'
const mocks = vi.hoisted(() => ({ actor: vi.fn(), suggest: vi.fn() }))
vi.mock('@/lib/current-actor', () => ({ withCurrentActor: mocks.actor }))
vi.mock('@/lib/ocr', () => ({ suggestFields: mocks.suggest, OCR_SETTINGS: { maxBytes: 1024 * 1024, maxPixels: 12_000_000, readMs: 1000 } }))
import { POST } from '@/app/api/expense-notes/receipt-suggestion/route'
const png = readFileSync('tests/fixtures/leandro/LE-01/valid.png')
function request(buffer = png, mime = 'image/png') {
  const form = new FormData(); form.append('receipt', new File([buffer], 'synthetic', { type: mime }))
  return new Request('http://localhost/api/expense-notes/receipt-suggestion', { method: 'POST', body: form })
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.actor.mockImplementation(async (_role, callback) => callback({}, { id: 'actor', companyId: 'company', role: 'employee' }))
  mocks.suggest.mockResolvedValue({})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())
it('refreshes authority before reading and before queueing, without an open actor transaction during OCR', async () => {
  let inside = false
  mocks.actor.mockImplementation(async (_role, callback) => { inside = true; try { return await callback({}, {}) } finally { inside = false } })
  mocks.suggest.mockImplementation(async () => { expect(inside).toBe(false); return { amount: 12.3 } })
  const response = await POST(request())
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ amount: 12.3 })
  expect(mocks.actor).toHaveBeenCalledTimes(2)
  expect(mocks.suggest).toHaveBeenCalledOnce()
  expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
})
it.each([1, 2])('refuses revocation at actor check %i without starting work', async check => {
  mocks.actor.mockImplementationOnce(async () => { if (check === 1) throw new ApiError('unauthenticated') })
  if (check === 2) mocks.actor.mockRejectedValueOnce(new ApiError('unauthenticated'))
  expect((await POST(request())).status).toBe(401)
  expect(mocks.suggest).not.toHaveBeenCalled()
})
it.each([[Buffer.alloc(0), 'image/png', 400], [png, 'application/pdf', 415], [Buffer.alloc(1024 * 1024 + 1), 'image/png', 413]] as const)('rejects invalid input without starting work %#', async (data, mime, status) => {
  expect((await POST(request(data, mime))).status).toBe(status)
  expect(mocks.suggest).not.toHaveBeenCalled()
})
it.each([['ocr_timeout', 504], ['ocr_busy', 503], ['ocr_failure', 502], ['request_aborted', 499]] as const)('keeps %s distinct from successful empty output', async (code, status) => {
  mocks.suggest.mockRejectedValue(new ApiError(code))
  const response = await POST(request())
  expect(response.status).toBe(status)
  expect(response.headers.get('content-type')).toBe('application/problem+json')
  const body = await response.json()
  expect(body.type).toBe(`urn:expense-io:problem:${code}`)
  expect(body.requestId).toBe(response.headers.get('x-request-id'))
})
