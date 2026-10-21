import { describe, expect, it } from 'vitest'
import { selectOcrSuggestions } from '@/utils/ocr-suggestion'

describe('selectOcrSuggestions', () => {
  it('keeps fields edited after OCR started', () => {
    expect(selectOcrSuggestions({
      amount: 12.34,
      expenseDate: '2026-10-16',
      amountAtStart: '',
      expenseDateAtStart: '',
      amountEditedSinceStart: true,
      expenseDateEditedSinceStart: false,
    })).toEqual({ amount: null, expenseDate: '2026-10-16' })
  })

  it('fills only empty untouched fields and rejects invalid values', () => {
    expect(selectOcrSuggestions({
      amount: 0,
      expenseDate: '2025-02-29',
      amountAtStart: '',
      expenseDateAtStart: '',
      amountEditedSinceStart: false,
      expenseDateEditedSinceStart: false,
    })).toEqual({ amount: null, expenseDate: null })
  })
})
