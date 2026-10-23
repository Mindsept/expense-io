import { observeHttp } from '@/observability/diagnostics'
import { withCurrentActor } from '@/lib/current-actor'
import { ApiError, withApiHandler } from '@/lib/errors'
import { suggestFields, OCR_SETTINGS } from '@/lib/ocr'
import { readBoundedForm, closeRejectedUpload } from '@/lib/bounded-form'
import { validateOcrImage } from '@/lib/ocr-image'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const response = await withApiHandler(request, 'expense-notes.receipt-suggestion', async ({ requestId }) => {
    await withCurrentActor(undefined, async () => {})
    const form = await readBoundedForm(request, OCR_SETTINGS.maxBytes + 64 * 1024, OCR_SETTINGS.readMs)
    const receipt = form.get('receipt')
    if (form.getAll('receipt').length !== 1 || !(receipt instanceof File) || !receipt.size) throw new ApiError('validation')
    if (receipt.size > OCR_SETTINGS.maxBytes) throw new ApiError('payload_too_large')
    const data = Buffer.from(await receipt.arrayBuffer())
    validateOcrImage(data, receipt.type, OCR_SETTINGS.maxPixels)
    // Body reads do not hold a SQL lock. Refresh rights again before queueing work.
    await withCurrentActor(undefined, async () => {})
    return Response.json(await suggestFields({ data, mimeType: receipt.type }, request.signal, { requestId }))
  }, observeHttp)
  return closeRejectedUpload(response)
}
