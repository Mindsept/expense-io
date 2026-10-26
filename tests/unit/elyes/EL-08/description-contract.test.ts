import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { MAX_DESCRIPTION_LENGTH, readExpenseInput } from '@/lib/expense-input'

function submission(description: string) {
  const form = new FormData()
  form.set('amount', '12.34')
  form.set('expenseDate', '2026-10-26')
  form.set('description', description)
  form.set('receipt', new File([readFileSync('tests/fixtures/leandro/LE-01/valid.png')], 'receipt.png', { type: 'image/png' }))
  return form
}

it('keeps the 4000 UTF-16 contract, including outer whitespace and surrogate pairs', async () => {
  expect(MAX_DESCRIPTION_LENGTH).toBe(4000)
  const value = '😀'.repeat(2000)
  expect((await readExpenseInput(submission(`  ${value}  `))).description).toBe(value)
})

it.each(['x'.repeat(4001), '😀'.repeat(2001)])('still rejects an oversized description through the real input validator', async description => {
  await expect(readExpenseInput(submission(description))).rejects.toMatchObject({ code: 'validation' })
})
