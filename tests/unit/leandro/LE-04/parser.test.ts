import { expect, it } from 'vitest'
import corpus from '../../../fixtures/leandro/LE-04/text-corpus.json'
import { parseReceiptText } from '@/lib/ocr-parser'

it.each(corpus)('$id: parses or abstains using the independently specified truth', ({ text, expected }) => {
  expect(parseReceiptText(text)).toEqual(expected)
})

it('does not retain candidates between calls', () => {
  expect(parseReceiptText('TOTAL 1234,56')).toEqual({ amount: 1234.56 })
  expect(parseReceiptText('')).toEqual({})
  expect(parseReceiptText('TOTAL 35')).toEqual({ amount: 35 })
})
