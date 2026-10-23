import { ApiError } from '@/lib/errors'
import { hasReceiptContent } from '@/lib/receipt-validation'
import { isCivilDate } from '@/utils/validators'

export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024
export const MAX_DESCRIPTION_LENGTH = 4000
const extensions = new Map([
  ['image/png', '.png'], ['image/jpeg', '.jpg'], ['image/webp', '.webp'], ['application/pdf', '.pdf'],
])
const sorts = new Map([
  ['created_at DESC', 'created_at DESC'], ['created_at ASC', 'created_at ASC'],
  ['amount DESC', 'amount DESC'], ['amount ASC', 'amount ASC'],
  ['expense_date DESC', 'expense_date DESC'], ['expense_date ASC', 'expense_date ASC'],
])

export function expenseSort(parameters: URLSearchParams): string {
  if (parameters.getAll('sort').length > 1) throw new ApiError('validation')
  const sort = sorts.get(parameters.get('sort') || 'created_at DESC')
  if (!sort) throw new ApiError('validation')
  return sort
}

export function isExpenseAmount(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,8}(?:\.\d{1,2})?$/.test(value) && Number(value) > 0
}

export async function readExpenseForm(request: Request) {
  let form: FormData
  try { form = await request.formData() }
  catch (error) {
    if (error instanceof TypeError) throw new ApiError('validation')
    throw error
  }
  return readExpenseInput(form)
}

/** All checks complete before expense SQL or storage writes. Authentication may query the DB. */
export async function readExpenseInput(form: FormData) {
  for (const name of ['amount', 'expenseDate', 'description', 'receipt']) {
    if (form.getAll(name).length !== 1) throw new ApiError('validation')
  }
  const amount = form.get('amount')
  const expenseDate = form.get('expenseDate')
  const rawDescription = form.get('description')
  const receipt = form.get('receipt')
  const description = typeof rawDescription === 'string' ? rawDescription.trim() : ''
  if (!isExpenseAmount(amount) || !isCivilDate(expenseDate) || !description ||
      description.length > MAX_DESCRIPTION_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description) ||
      !(receipt instanceof File) || receipt.size === 0 || receipt.size > MAX_RECEIPT_BYTES) throw new ApiError('validation')
  const extension = extensions.get(receipt.type)
  if (!extension) throw new ApiError('validation')
  const buffer = Buffer.from(await receipt.arrayBuffer())
  if (!hasReceiptContent(buffer, receipt.type)) throw new ApiError('validation')
  return { amount, expenseDate, description, buffer, mimeType: receipt.type, extension }
}
