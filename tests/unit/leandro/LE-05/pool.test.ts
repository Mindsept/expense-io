import { resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { OcrPool } from '@/lib/ocr-pool.mjs'

const pools: OcrPool[] = []
function create(overrides = {}) {
  const pool = new OcrPool({ workers: 1, queue: 1, queueMs: 3000, timeoutMs: 1000, idleMs: 100, ...overrides }, { workerPath: resolve('tests/contracts/leandro/LE-05/pool-worker.mjs') })
  pools.push(pool); return pool
}
function pid(pool: OcrPool): number { return [...pool.slots][0].child.pid }
function gone(id: number) { try { process.kill(id, 0); return false } catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' } }
afterEach(async () => { await Promise.all(pools.splice(0).map(pool => pool.close())) })

it('reuses a healthy child, bounds worker count and releases idle capacity', async () => {
  const pool = create()
  expect(await pool.recognize(Buffer.from('valid'))).toBe('TOTAL 12,30')
  const first = pid(pool)
  for (let index = 0; index < 3; index++) await pool.recognize(Buffer.from('valid'))
  expect(pid(pool)).toBe(first)
  expect(pool.snapshot()).toMatchObject({ active: 0, queued: 0, completed: 4, peakWorkers: 1 })
  expect(pool.snapshot().childRssBytes).toBeGreaterThan(0)
  await expect.poll(() => pool.snapshot().workers).toBe(0)
  expect(gone(first)).toBe(true)
})
it.each(['hang', 'stall-init'])('kills %s before a queued job gets the released slot', async command => {
  const pool = create()
  const first = pool.recognize(Buffer.from(command))
  const rejected = expect(first).rejects.toMatchObject({ code: 'ocr_timeout' })
  const old = pid(pool)
  const next = pool.recognize(Buffer.from('valid'))
  await expect(pool.recognize(Buffer.from('extra'))).rejects.toMatchObject({ code: 'ocr_busy' })
  expect(pool.snapshot()).toMatchObject({ workers: 1, active: 1, queued: 1 })
  await rejected
  expect(gone(old)).toBe(true)
  expect(await next).toBe('TOTAL 12,30')
  expect(pid(pool)).not.toBe(old)
  expect(pool.snapshot()).toMatchObject({ active: 0, queued: 0, peakWorkers: 1 })
})
it.each(['error', 'exit'])('recovers after a child %s without leaking capacity', async command => {
  const pool = create()
  const first = pool.recognize(Buffer.from(command)), old = pid(pool)
  await expect(first).rejects.toMatchObject({ code: 'ocr_failure' })
  expect(gone(old)).toBe(true)
  expect(await pool.recognize(Buffer.from('valid'))).toBe('TOTAL 12,30')
})
it('bounds queue wait and removes aborted waiting requests', async () => {
  const pool = create({ queueMs: 100, timeoutMs: 1200 })
  const active = expect(pool.recognize(Buffer.from('hang'))).rejects.toMatchObject({ code: 'ocr_timeout' })
  await expect(pool.recognize(Buffer.from('valid'))).rejects.toMatchObject({ code: 'ocr_busy' })
  const controller = new AbortController()
  const queued = pool.recognize(Buffer.from('valid'), controller.signal)
  controller.abort()
  await expect(queued).rejects.toMatchObject({ code: 'request_aborted' })
  expect(pool.snapshot().queued).toBe(0)
  await active
})
it('waits for actual child/thread termination on cancellation and then recovers', async () => {
  const pool = create(), controller = new AbortController()
  const active = pool.recognize(Buffer.from('hang'), controller.signal), old = pid(pool)
  controller.abort()
  await expect(active).rejects.toMatchObject({ code: 'request_aborted' })
  expect(gone(old)).toBe(true)
  expect(await pool.recognize(Buffer.from('valid'))).toBe('TOTAL 12,30')
})
it('rejects an already cancelled request without creating a child', async () => {
  const pool = create()
  await expect(pool.recognize(Buffer.from('valid'), AbortSignal.abort())).rejects.toMatchObject({ code: 'request_aborted' })
  expect(pool.snapshot().workers).toBe(0)
})
it('closes owned active and waiting jobs and forbids subsequent work', async () => {
  const pool = create()
  const first = expect(pool.recognize(Buffer.from('hang'))).rejects.toMatchObject({ code: 'ocr_failure' })
  const queued = expect(pool.recognize(Buffer.from('valid'))).rejects.toMatchObject({ code: 'ocr_failure' })
  await pool.close(); await first; await queued
  expect(pool.snapshot()).toMatchObject({ workers: 0, active: 0, queued: 0 })
  await expect(pool.recognize(Buffer.from('valid'))).rejects.toMatchObject({ code: 'ocr_failure' })
})
it('quarantines a slot if termination throws instead of falsely releasing capacity', async () => {
  const pool = create({ queue: 0 }), controller = new AbortController()
  const active = pool.recognize(Buffer.from('hang'), controller.signal)
  const slot = [...pool.slots][0], kill = slot.child.kill.bind(slot.child)
  slot.child.kill = () => { throw new Error('Synthetic termination failure') }
  try {
    controller.abort()
    await expect(active).rejects.toMatchObject({ code: 'ocr_failure' })
    expect(pool.snapshot()).toMatchObject({ workers: 1, stopping: 1 })
    await expect(pool.recognize(Buffer.from('valid'))).rejects.toMatchObject({ code: 'ocr_busy' })
  } finally { slot.child.kill = kill; await pool.close() }
})
