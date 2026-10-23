import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { expenseSort, isExpenseAmount, MAX_RECEIPT_BYTES, readExpenseInput } from '@/lib/expense-input'
import { hasReceiptContent } from '@/lib/receipt-validation'

const validFiles = [
  ['valid.png', 'image/png'], ['valid.jpg', 'image/jpeg'], ['progressive.jpg', 'image/jpeg'],
  ['valid.webp', 'image/webp'], ['lossless.webp', 'image/webp'], ['valid.pdf', 'application/pdf'],
] as const
const bytesFor = (name: string) => readFileSync(`tests/fixtures/leandro/LE-01/${name}`)

function form(file = new File([bytesFor('valid.png')], 'receipt.png', { type: 'image/png' })) {
  const body = new FormData()
  body.set('amount', '0.01')
  body.set('expenseDate', '2099-12-31')
  body.set('description', '  Synthetic taxi  ')
  body.set('receipt', file)
  return body
}

it.each(['0.01', '12', '12.3', '12.34', '0012.34', '99999999.99'])('accepts the full decimal %s', value => {
  expect(isExpenseAmount(value)).toBe(true)
})
it.each(['+12', '-1', '', '1e3', '1.234', 'Infinity', 'NaN', '0.00', '100000000.00', '12garbage', null, 12])('rejects non-contract amount %s', value => {
  expect(isExpenseAmount(value)).toBe(false)
})

it.each(validFiles)('accepts a real %s container and derives the extension from MIME', async (name, mimeType) => {
  const bytes = bytesFor(name)
  const input = await readExpenseInput(form(new File([bytes], 'client-controlled.exe', { type: mimeType })))
  expect(input.buffer).toEqual(bytes)
  expect(input.mimeType).toBe(mimeType)
  expect(input.extension).toBe(mimeType === 'image/jpeg' ? '.jpg' : name.slice(name.lastIndexOf('.')))
  expect(input.amount).toBe('0.01')
  expect(input.expenseDate).toBe('2099-12-31')
  expect(input.description).toBe('Synthetic taxi')
})

it.each(validFiles)('rejects a truncated %s container', (name, mimeType) => {
  const bytes = bytesFor(name)
  expect(hasReceiptContent(bytes.subarray(0, bytes.length - 5), mimeType)).toBe(false)
})

it('rejects a corrupt PNG even if its signature was kept', () => {
  const bytes = Buffer.from(bytesFor('valid.png'))
  bytes[40] ^= 1
  expect(hasReceiptContent(bytes, 'image/png')).toBe(false)
})

it('does not mask high bits when recognizing binary FourCC identifiers', () => {
  const bytes = Buffer.from(bytesFor('valid.webp'))
  bytes[0] |= 128
  expect(hasReceiptContent(bytes, 'image/webp')).toBe(false)
})

it.each(['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain'])('rejects small junk safely as %s', mimeType => {
  for (let size = 0; size < 64; size++) expect(hasReceiptContent(Buffer.alloc(size, 0xff), mimeType)).toBe(false)
})

it('rejects too-large receipts before reading their bytes', async () => {
  const body = form(new File([new Uint8Array(MAX_RECEIPT_BYTES + 1)], 'large.png', { type: 'image/png' }))
  const receipt = body.get('receipt') as File
  const read = vi.spyOn(receipt, 'arrayBuffer')
  await expect(readExpenseInput(body)).rejects.toMatchObject({ code: 'validation' })
  expect(read).not.toHaveBeenCalled()
})

it('rejects repeated or missing fields and accepts the description boundary', async () => {
  const repeated = form()
  repeated.append('amount', '12')
  await expect(readExpenseInput(repeated)).rejects.toMatchObject({ code: 'validation' })
  const missing = form()
  missing.delete('receipt')
  await expect(readExpenseInput(missing)).rejects.toMatchObject({ code: 'validation' })
  const boundary = form()
  boundary.set('description', 'x'.repeat(4000))
  expect((await readExpenseInput(boundary)).description).toHaveLength(4000)
})

it('only returns fixed SQL fragments and preserves the default', () => {
  expect(expenseSort(new URLSearchParams())).toBe('created_at DESC')
  expect(() => expenseSort(new URLSearchParams('sort=amount+ASC&sort=created_at+DESC'))).toThrow()
  expect(() => expenseSort(new URLSearchParams('sort=__proto__'))).toThrow()
})
