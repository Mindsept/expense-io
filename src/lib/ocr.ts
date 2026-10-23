import { ApiError } from '@/lib/errors'
import { parseReceiptText, type ExpenseNoteSuggestion } from '@/lib/ocr-parser'
import { OcrPool, OcrPoolError } from '@/lib/ocr-pool.mjs'
import { ocrSettings } from '@/lib/ocr-settings'
export type { ExpenseNoteSuggestion } from '@/lib/ocr-parser'

export const OCR_SETTINGS = ocrSettings()
const pool = new OcrPool(OCR_SETTINGS)
export function ocrCapacity() { return pool.snapshot() }

export async function suggestFields(receipt: { data: Buffer; mimeType: string }, signal?: AbortSignal): Promise<ExpenseNoteSuggestion> {
  try { return parseReceiptText(await pool.recognize(receipt.data, signal)) }
  catch (error) {
    if (error instanceof OcrPoolError) {
      switch (error.code) {
        case 'ocr_timeout': throw new ApiError('ocr_timeout')
        case 'ocr_busy': throw new ApiError('ocr_busy')
        case 'request_aborted': throw new ApiError('request_aborted')
      }
    }
    throw new ApiError('ocr_failure')
  }
}
