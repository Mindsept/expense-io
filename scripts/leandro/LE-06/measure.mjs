// Reproducible, bounded component experiment; no HTTP/DB, receipts or production SLO.
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { OcrPool } from '../../../src/lib/ocr-pool.mjs'

try {
  const fixtures = JSON.parse(await readFile('tests/fixtures/leandro/LE-04/images.json', 'utf8'))
  if (fixtures.length !== 8) throw new Error('Review corpus before changing the experiment')
  const images = await Promise.all(fixtures.map(fixture => readFile(`tests/fixtures/leandro/LE-04/images/${fixture.id}.png`)))
  const percentile = (values, fraction) => values.length ? [...values].sort((a,b) => a-b)[Math.ceil(values.length * fraction) - 1] : null
  const scenarios = []
  const options = { workers: 1, queue: 2, queueMs: 3000, timeoutMs: 20000, idleMs: 30000 }
  for (const concurrency of [1,3,6]) {
    const pool = new OcrPool(options), delay = monitorEventLoopDelay({ resolution: 10 })
    delay.enable()
    const outcomes = [], durations = [], parentBefore = process.memoryUsage().rss
    let peakWorkers = 0, peakQueued = 0, peakActive = 0, peakChildRss = 0
    const sample = () => {
      const state = pool.snapshot()
      peakWorkers = Math.max(peakWorkers, state.workers); peakQueued = Math.max(peakQueued, state.queued)
      peakActive = Math.max(peakActive, state.active); peakChildRss = Math.max(peakChildRss, state.childRssBytes)
    }
    // Hard work cancellation for the complete scenario, in addition to each
    // recognition/queue deadline. Capacity is still released only after exit.
    const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 120000)
    const interval = setInterval(sample, 10), started = performance.now()
    try {
      for (let start = 0; start < 24; start += concurrency) {
        await Promise.all(Array.from({ length: Math.min(concurrency, 24-start) }, async (_, offset) => {
          const time = performance.now()
          try {
            await pool.recognize(images[(start+offset) % images.length], controller.signal)
            durations.push(performance.now()-time); outcomes.push('success')
          } catch (error) {
            outcomes.push(['ocr_busy','ocr_timeout','request_aborted'].includes(error?.code) ? error.code : 'ocr_failure')
          } finally { sample() }
        }))
      }
    } finally {
      clearTimeout(deadline); clearInterval(interval); delay.disable()
      await pool.close()
    }
    const after = pool.snapshot()
    if (after.workers || after.active || after.queued || after.stopping || peakWorkers > options.workers || peakQueued > options.queue) throw new Error('Experiment did not release bounded capacity')
    scenarios.push({ concurrency, requests: outcomes.length, options,
      counts: Object.fromEntries([...new Set(outcomes)].map(code => [code, outcomes.filter(value => value === code).length])),
      wallMs: Math.round(performance.now()-started),
      successLatencyMs: { min: durations.length ? Math.min(...durations) : null, p50: percentile(durations,.5), p95: percentile(durations,.95), max: durations.length ? Math.max(...durations) : null },
      sampledCapacity: { peakWorkers, peakQueued, peakActive, peakChildRss }, parentRssBefore: parentBefore, parentRssAfter: process.memoryUsage().rss,
      parentEventLoopDelayMs: { mean: Number.isFinite(delay.mean) ? delay.mean/1e6 : null, max: delay.max/1e6 }, after })
  }
  const sha256 = data => createHash('sha256').update(data).digest('hex')
  console.log(JSON.stringify({ schema: 'expense.ocr.decision-measure.v1', node: process.version, platform: process.platform, arch: process.arch,
    scope: 'local pool component; not HTTP or production workload', corpus: fixtures.length,
    source: { gitHead: execFileSync('git', ['rev-parse','HEAD'], { encoding: 'utf8' }).trim(),
      poolSha256: sha256(await readFile('src/lib/ocr-pool.mjs')), workerSha256: sha256(await readFile('scripts/leandro/LE-05/ocr-worker.mjs')) }, scenarios }, null, 2))
  if (scenarios.some(scenario => scenario.counts.ocr_failure || scenario.counts.request_aborted)) process.exitCode = 1
} catch {
  console.error(JSON.stringify({ operation: 'ocr.decision.measure', code: 'experiment_failed' }))
  process.exitCode = 1
}
