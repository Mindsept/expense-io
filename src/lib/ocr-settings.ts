/** All OCR settings are integral, bounded and read once when the route is loaded. */
export function ocrSettings(env: Record<string, string | undefined> = process.env) {
  function integer(name: string, fallback: number, min: number, max: number) {
    const raw = env[name]
    if (raw !== undefined && !/^\d+$/.test(raw)) throw new Error('Invalid OCR configuration')
    const value = raw === undefined ? fallback : Number(raw)
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid OCR configuration')
    return value
  }
  return Object.freeze({
    maxBytes: integer('OCR_MAX_FILE_BYTES', 5 * 1024 * 1024, 1024, 10 * 1024 * 1024),
    maxPixels: integer('OCR_MAX_PIXELS', 12_000_000, 1, 32_000_000),
    workers: integer('OCR_WORKERS', 1, 1, 4),
    queue: integer('OCR_QUEUE_LIMIT', 2, 0, 16),
    queueMs: integer('OCR_QUEUE_TIMEOUT_MS', 3000, 100, 10_000),
    timeoutMs: integer('OCR_TASK_TIMEOUT_MS', 20_000, 100, 60_000),
    idleMs: integer('OCR_IDLE_TIMEOUT_MS', 30_000, 100, 300_000),
    readMs: integer('OCR_BODY_TIMEOUT_MS', 10_000, 100, 30_000),
  })
}
