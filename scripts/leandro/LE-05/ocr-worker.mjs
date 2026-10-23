/* Owned child process: killing this PID terminates Tesseract's worker_threads,
 * including initialization before createWorker has resolved. No secret env/logs. */
import path from 'node:path'
import { createWorker } from 'tesseract.js'
let worker
let busy = false
process.on('disconnect', () => process.exit(0))
process.on('message', async message => {
  if (busy || !Buffer.isBuffer(message?.data)) { process.exit(1); return }
  busy = true
  try {
    worker ??= await createWorker('fra', undefined, {
      langPath: path.join(process.cwd(), 'tessdata'), cacheMethod: 'none',
      errorHandler: () => {}, logger: () => {},
    })
    const { data: { text } } = await worker.recognize(message.data)
    if (typeof text !== 'string' || text.length > 131072) throw new Error('Invalid OCR result')
    process.send?.({ kind: 'result', text, memoryBytes: process.memoryUsage().rss })
  } catch {
    process.send?.({ kind: 'error' })
  } finally { busy = false }
})
