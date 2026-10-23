import { measurePhase } from '@/observability/diagnostics'
import { ApiError } from '@/lib/errors'
import { parseReceiptText, type ExpenseNoteSuggestion } from '@/lib/ocr-parser'
import { OcrPool, OcrPoolError } from '@/lib/ocr-pool.mjs'
import { ocrSettings } from '@/lib/ocr-settings'
export type { ExpenseNoteSuggestion } from '@/lib/ocr-parser'

export const OCR_SETTINGS = ocrSettings()
const pool = new OcrPool(OCR_SETTINGS)
export function ocrCapacity() { return pool.snapshot() }

export async function suggestFields(receipt: { data: Buffer; mimeType: string }, signal?: AbortSignal, context: { requestId?: string } = {}): Promise<ExpenseNoteSuggestion> {
  try { return await measurePhase('ocr.recognize', context, async () => parseReceiptText(await pool.recognize(receipt.data, signal)),
    suggestion => Object.values(suggestion).some(value => value !== undefined) ? 'ocr_suggested' : 'ocr_empty',
    error => error instanceof OcrPoolError && ['ocr_timeout', 'ocr_busy', 'request_aborted'].includes(error.code) ? error.code : 'ocr_failed', () => pool.snapshot()) }
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
