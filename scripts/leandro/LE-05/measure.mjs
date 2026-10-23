// Bounded synthetic corpus; emits aggregate resource measurements, never OCR text.
import { readFile } from 'node:fs/promises'
import { OcrPool } from '../../../src/lib/ocr-pool.mjs'
const fixtures = JSON.parse(await readFile('tests/fixtures/leandro/LE-04/images.json', 'utf8'))
const pool = new OcrPool({ workers: 1, queue: 2, queueMs: 3000, timeoutMs: 20_000, idleMs: 30_000 })
const samples = []
const started = performance.now(), parentBefore = process.memoryUsage().rss
try {
  for (let batch = 0; batch < 3; batch++) {
    for (const fixture of fixtures) {
      const data = await readFile(`tests/fixtures/leandro/LE-04/images/${fixture.id}.png`)
      const start = performance.now()
      await pool.recognize(data)
      const snapshot = pool.snapshot()
      samples.push({ durationMs: Math.round(performance.now() - start), workers: snapshot.workers, active: snapshot.active,
        queued: snapshot.queued, childRssBytes: snapshot.childRssBytes, parentRssBytes: process.memoryUsage().rss })
    }
  }
  const during = pool.snapshot()
  await pool.close()
  console.log(JSON.stringify({ operation: 'ocr.synthetic.measure', requests: samples.length, durationMs: Math.round(performance.now() - started),
    parentBefore, peakChildRssBytes: Math.max(...samples.map(sample => sample.childRssBytes)),
    peakParentRssBytes: Math.max(...samples.map(sample => sample.parentRssBytes)), during, after: pool.snapshot(), samples }, null, 2))
} finally { await pool.close() }
