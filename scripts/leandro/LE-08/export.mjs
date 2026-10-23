import { createReadStream } from 'node:fs'
import { ObservationRegistry } from '../../../src/observability/registry.mjs'

/** Bounded log framing: skip oversized/non-JSON lines instead of retaining them. */
async function* records(stream) {
  let partial = '', oversized = false
  for await (const chunk of stream) {
    const parts = chunk.toString('utf8').split('\n')
    for (let index = 0; index < parts.length; index++) {
      if (!oversized) {
        partial += parts[index]
        if (Buffer.byteLength(partial) > 8192) { partial = ''; oversized = true }
      }
      if (index < parts.length - 1) {
        if (!oversized) { try { yield JSON.parse(partial) } catch {} }
        partial = ''; oversized = false
      }
    }
  }
  if (partial && !oversized) { try { yield JSON.parse(partial) } catch {} }
}
try {
  const args = process.argv.slice(2)
  const options = {}
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1]
    if (!['--input', '--request-id', '--limit'].includes(key) || options[key] !== undefined || !value) throw new Error('Invalid options')
    options[key] = value
  }
  if (!options['--input']) throw new Error('Explicit input is required')
  const requestId = options['--request-id']?.toLowerCase()
  if (requestId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) throw new Error('Invalid request ID')
  const limit = options['--limit'] === undefined ? 20 : /^\d+$/.test(options['--limit']) ? Number(options['--limit']) : NaN
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid limit')
  const input = options['--input'] === '-' ? process.stdin : createReadStream(options['--input'], { highWaterMark: 65536 })
  const registry = new ObservationRegistry(), events = []
  let matched = 0
  for await (const record of records(input)) {
    const event = registry.record(record)
    if (requestId && event?.requestId === requestId) { matched++; if (events.length < limit) events.push(event) }
  }
  console.log(JSON.stringify(requestId ? { mode: 'correlation', events, truncated: matched > limit } : { mode: 'aggregate', ...registry.snapshot() }, null, 2))
} catch {
  console.error(JSON.stringify({ operation: 'diagnostics.export', code: 'invalid_input_or_read_failure' }))
  process.exitCode = 1
}
