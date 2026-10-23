import { beforeEach, expect, it, vi } from 'vitest'

const engine = vi.hoisted(() => ({ recognize: vi.fn() }))
vi.mock('@/lib/ocr-pool.mjs', () => ({ OcrPool: class { recognize = engine.recognize }, OcrPoolError: class extends Error {} }))
import { suggestFields } from '@/lib/ocr'

beforeEach(() => vi.clearAllMocks())

it.each([
  ['TOTAL 1234,56', { amount: 1234.56 }],
  ['TOTAL 1 234,56', { amount: 1234.56 }],
  ['HT100\nTTC120', { amount: 120 }],
  ['SOUS-TOTAL 40\nREMISE 5\nTOTAL 35', { amount: 35 }],
  ['TOTAL 12,00\nTOTAL 18,00', {}],
  ['', {}],
])('production extraction parses %s through the bounded extraction bridge', async (text, expected) => {
  engine.recognize.mockResolvedValue(text)
  const result = await suggestFields({ data: Buffer.from('synthetic'), mimeType: 'image/png' })
  expect(JSON.parse(JSON.stringify(result))).toEqual(expected)
  expect(engine.recognize).toHaveBeenCalledWith(Buffer.from('synthetic'), undefined)
})
