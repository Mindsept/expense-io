import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ recognize: vi.fn(), snapshot: vi.fn() }))
vi.mock('@/lib/ocr-pool.mjs', () => ({
  OcrPool: class { recognize = mocks.recognize; snapshot = mocks.snapshot },
  OcrPoolError: class extends Error { constructor(public code: string) { super(code) } },
}))
import { OcrPoolError } from '@/lib/ocr-pool.mjs'
import { ocrCapacity, suggestFields } from '@/lib/ocr'
beforeEach(() => { vi.clearAllMocks(); mocks.snapshot.mockReturnValue({ active: 0, queued: 0 }); vi.spyOn(console, 'info').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => vi.restoreAllMocks())
it('parses recognized text and preserves cancellation at the pool boundary', async () => {
  mocks.recognize.mockResolvedValue('TOTAL TTC 18,75 EUR\n20/10/2026')
  const receipt = { data: Buffer.from('image'), mimeType: 'image/png' }, signal = new AbortController().signal
  expect(await suggestFields(receipt, signal, { requestId: 'synthetic' })).toEqual({ amount: 18.75, expenseDate: '2026-10-20' })
  expect(mocks.recognize).toHaveBeenCalledWith(receipt.data, signal)
  expect(ocrCapacity()).toEqual({ active: 0, queued: 0 })
  mocks.recognize.mockResolvedValue('unreadable')
  expect(await suggestFields(receipt)).toEqual({})
})
it.each(['ocr_timeout', 'ocr_busy', 'request_aborted', 'worker_crash', 'unexpected'])('maps %s to a stable public failure', async code => {
  mocks.recognize.mockRejectedValue(code === 'unexpected' ? new Error('private worker details') : new OcrPoolError(code))
  await expect(suggestFields({ data: Buffer.from('x'), mimeType: 'image/png' })).rejects.toMatchObject({ code: ['ocr_timeout', 'ocr_busy', 'request_aborted'].includes(code) ? code : 'ocr_failure' })
})
