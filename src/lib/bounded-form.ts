import { ApiError } from '@/lib/errors'

/** Limit actual stream bytes before multipart parsing; never trust Content-Length. */
export async function readBoundedForm(request: Request, maxBytes: number, timeoutMs: number): Promise<FormData> {
  const declared = request.headers.get('content-length')
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    throw new ApiError('payload_too_large')
  }
  if (!request.body) throw new ApiError('validation')
  if (request.signal.aborted) throw new ApiError('request_aborted')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  let failure: ApiError | undefined
  function stop(error: ApiError) {
    failure ??= error
    // Cancellation is best effort; a hostile upstream cancellation promise must
    // not hold the request open after its pending read is resolved by cancel().
    void reader.cancel().catch(() => {})
  }
  const abort = () => stop(new ApiError('request_aborted'))
  request.signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => stop(new ApiError('request_timeout')), timeoutMs)
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (failure) throw failure
      if (done) break
      length += value.byteLength
      // Canceling Node's IncomingMessage here can destroy the socket before 413.
      // Stop pulling, release the reader, and close the response connection below.
      if (length > maxBytes) throw new ApiError('payload_too_large')
      chunks.push(value)
    }
    const body = Buffer.concat(chunks, length)
    try {
      return await new Response(body, { headers: { 'Content-Type': request.headers.get('content-type') ?? '' } }).formData()
    } catch { throw new ApiError('validation') }
  } finally {
    clearTimeout(timer)
    request.signal.removeEventListener('abort', abort)
    reader.releaseLock()
  }
}

/** Close rejected uploads after the error response is flushed, not before it. */
export function closeRejectedUpload(response: Response): Response {
  if (response.status === 413 || response.status === 408) response.headers.set('Connection', 'close')
  return response
}
