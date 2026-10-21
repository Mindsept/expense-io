import { formatCivilDate } from '@/utils/civil-date'

export interface OcrSuggestionInput {
  amount: unknown
  expenseDate: unknown
  amountAtStart: string
  expenseDateAtStart: string
  amountEditedSinceStart: boolean
  expenseDateEditedSinceStart: boolean
}

export function selectOcrSuggestions(input: OcrSuggestionInput): {
  amount: string | null
  expenseDate: string | null
} {
  const validAmount = typeof input.amount === 'number' && Number.isFinite(input.amount) && input.amount > 0
  const validDate = typeof input.expenseDate === 'string' &&
    formatCivilDate(input.expenseDate) !== 'Date indisponible'

  return {
    amount: validAmount && !input.amountAtStart && !input.amountEditedSinceStart
      ? String(input.amount)
      : null,
    expenseDate: validDate && !input.expenseDateAtStart && !input.expenseDateEditedSinceStart
      ? input.expenseDate as string
      : null,
  }
}
