import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { readBoundedForm } from '@/lib/bounded-form'
import { validateOcrImage } from '@/lib/ocr-image'
import { ocrSettings } from '@/lib/ocr-settings'

function streamRequest(headers: Record<string, string> = {}, bytes = 300) {
  let cancelled = false, reads = 0
  const body = new ReadableStream({ pull(controller) { reads++; controller.enqueue(new Uint8Array(bytes)) }, cancel() { cancelled = true } })
  const request = new Request('http://localhost.test', { method: 'POST', body, duplex: 'half', headers } as RequestInit)
  return { request, cancelled: () => cancelled, reads: () => reads }
}
it.each([{}, { 'content-length': '1' }, { 'content-length': 'invalid' }] as Record<string, string>[] )('bounds actual bytes before parsing with %s', async headers => {
  const fixture = streamRequest(headers)
  await expect(readBoundedForm(fixture.request, 512, 1000)).rejects.toMatchObject({ code: 'payload_too_large' })
  expect(fixture.request.body?.locked).toBe(false)
  expect(fixture.cancelled()).toBe(false) // preserve the socket until the 413 response is flushed
  expect(fixture.reads()).toBeLessThanOrEqual(3) // one upstream prefetched chunk may exist
})
it('rejects a declared oversized body without consuming its data', async () => {
  const fixture = streamRequest({ 'content-length': '999999' })
  await expect(readBoundedForm(fixture.request, 512, 1000)).rejects.toMatchObject({ code: 'payload_too_large' })
  expect(fixture.reads()).toBeLessThanOrEqual(1)
})
it('parses a bounded real multipart and rejects malformed multipart', async () => {
  const form = new FormData(); form.append('receipt', new File(['synthetic'], 'x.png', { type: 'image/png' }))
  const result = await readBoundedForm(new Request('http://localhost', { method: 'POST', body: form }), 4096, 1000)
  expect((result.get('receipt') as File).size).toBe(9)
  await expect(readBoundedForm(new Request('http://localhost', { method: 'POST', body: 'bad' }), 4096, 1000)).rejects.toMatchObject({ code: 'validation' })
})
it('cancels a stalled body at its reading deadline', async () => {
  let cancelled = false
  const body = new ReadableStream({ cancel() { cancelled = true } })
  await expect(readBoundedForm(new Request('http://localhost', { method: 'POST', body, duplex: 'half' } as RequestInit), 512, 25)).rejects.toMatchObject({ code: 'request_timeout' })
  expect(cancelled).toBe(true)
})
it('cancels an interrupted body and releases the reader', async () => {
  const controller = new AbortController(), body = new ReadableStream()
  const promise = readBoundedForm(new Request('http://localhost', { method: 'POST', body, signal: controller.signal, duplex: 'half' } as RequestInit), 512, 1000)
  controller.abort()
  await expect(promise).rejects.toMatchObject({ code: 'request_aborted' })
  expect(body.locked).toBe(false)
})
it.each(['valid.png', 'valid.jpg', 'progressive.jpg', 'valid.webp', 'lossless.webp'])('accepts structural and pixel bounds for %s', filename => {
  const mime = filename.endsWith('jpg') ? 'image/jpeg' : filename.endsWith('png') ? 'image/png' : 'image/webp'
  const data = readFileSync(`tests/fixtures/leandro/LE-01/${filename}`)
  expect(() => validateOcrImage(data, mime, 12_000_000)).not.toThrow()
  expect(() => validateOcrImage(data, mime, 1)).toThrow()
})
it('distinguishes unsupported PDF from malformed image', () => {
  expect(() => validateOcrImage(Buffer.from('PDF'), 'application/pdf', 100)).toThrowError(expect.objectContaining({ code: 'unsupported_ocr_media' }))
  expect(() => validateOcrImage(Buffer.from('invalid'), 'image/png', 100)).toThrowError(expect.objectContaining({ code: 'validation' }))
})
it('validates configuration once without reflecting its input', () => {
  expect(ocrSettings({})).toMatchObject({ workers: 1, queue: 2, timeoutMs: 20_000, maxBytes: 5242880 })
  for (const env of [{ OCR_WORKERS: '0' }, { OCR_QUEUE_LIMIT: '17' }, { OCR_MAX_FILE_BYTES: '-1' }, { OCR_TASK_TIMEOUT_MS: '100oops' }, { OCR_MAX_PIXELS: '33000000' }]) {
    expect(() => ocrSettings(env)).toThrow('Invalid OCR configuration')
  }
  expect(ocrSettings({ OCR_WORKERS: '2', OCR_QUEUE_LIMIT: '0' })).toMatchObject({ workers: 2, queue: 0 })
})
