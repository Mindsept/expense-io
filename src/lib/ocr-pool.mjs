import { fork } from 'node:child_process'
import { resolve } from 'node:path'

export class OcrPoolError extends Error {
  constructor(code) { super(code); this.code = code }
}

/** Reusable, process-local capacity. A failed child occupies its slot until exit. */
export class OcrPool {
  /** @param {{workers:number,queue:number,queueMs:number,timeoutMs:number,idleMs:number}} options
   * @param {{workerPath?:string}} [runtime] Internal injection for owned-process tests only, never request/env input. */
  constructor(options, runtime = {}) {
    this.options = options
    this.workerPath = runtime.workerPath ?? resolve('scripts/leandro/LE-05/ocr-worker.mjs')
    this.slots = new Set()
    this.waiting = []
    this.closed = false
    this.completed = 0
    this.peakWorkers = 0
  }

  snapshot() {
    return Object.freeze({ workers: this.slots.size, active: [...this.slots].filter(slot => slot.busy).length,
      queued: this.waiting.length, stopping: [...this.slots].filter(slot => slot.stopping).length,
      completed: this.completed, peakWorkers: this.peakWorkers,
      childRssBytes: [...this.slots].reduce((sum, slot) => sum + slot.memoryBytes, 0) })
  }

  /** @param {Buffer} data @param {AbortSignal} [signal] @returns {Promise<string>} */
  recognize(data, signal) {
    if (this.closed) return Promise.reject(new OcrPoolError('ocr_failure'))
    if (signal?.aborted) return Promise.reject(new OcrPoolError('request_aborted'))
    const available = [...this.slots].some(slot => !slot.busy && !slot.stopping) || this.slots.size < this.options.workers
    if (!available && this.waiting.length >= this.options.queue) return Promise.reject(new OcrPoolError('ocr_busy'))
    return new Promise((resolve, reject) => {
      const job = { data, signal, resolve, reject, timer: undefined, abort: undefined }
      const remove = (code) => {
        const index = this.waiting.indexOf(job)
        if (index === -1) return
        this.waiting.splice(index, 1)
        this.clearWaiting(job)
        reject(new OcrPoolError(code))
      }
      job.abort = () => remove('request_aborted')
      signal?.addEventListener('abort', job.abort, { once: true })
      job.timer = setTimeout(() => remove('ocr_busy'), this.options.queueMs)
      this.waiting.push(job)
      this.pump()
    })
  }

  clearWaiting(job) {
    clearTimeout(job.timer)
    job.signal?.removeEventListener('abort', job.abort)
  }

  spawn() {
    // Never forward DATABASE_URL, Auth.js secrets, S3 credentials or caller data.
    const child = fork(this.workerPath, [], { cwd: process.cwd(), execArgv: ['--max-old-space-size=256'],
      serialization: 'advanced', windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { NODE_ENV: 'production', PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } })
    const slot = { child, busy: false, stopping: false, exited: false, memoryBytes: 0, timer: undefined, done: undefined }
    slot.done = new Promise(resolve => {
      const exited = () => {
        if (slot.exited) return
        slot.exited = true
        clearTimeout(slot.timer)
        this.slots.delete(slot)
        resolve()
        this.pump()
      }
      child.once('exit', exited)
      child.once('close', exited) // also handles spawn failure, which has no exit event
      child.on('error', () => {}) // request listener maps it; never emit raw exceptions
    })
    this.slots.add(slot)
    this.peakWorkers = Math.max(this.peakWorkers, this.slots.size)
    return slot
  }

  pump() {
    if (this.closed) return
    while (this.waiting.length) {
      let slot = [...this.slots].find(item => !item.busy && !item.stopping)
      if (!slot && this.slots.size < this.options.workers) {
        try { slot = this.spawn() }
        catch {
          const job = this.waiting.shift(); this.clearWaiting(job)
          job.reject(new OcrPoolError('ocr_failure')); continue
        }
      }
      if (!slot) return
      const job = this.waiting.shift()
      this.clearWaiting(job)
      clearTimeout(slot.timer)
      slot.busy = true
      void this.run(slot, job)
    }
  }

  async stop(slot) {
    if (slot.exited) return
    slot.stopping = true
    clearTimeout(slot.timer)
    // Never release capacity on kill() alone: await the owned child's exit.
    try { if (!slot.child.kill('SIGKILL') && !slot.exited) throw new Error('Unable to terminate owned OCR child') }
    catch { throw new OcrPoolError('ocr_failure') } // remains quarantined/counted if termination failed
    await slot.done
  }

  async run(slot, job) {
    let failure
    try {
      const text = await new Promise((resolve, reject) => {
        let settled = false
        const finish = (error, text) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          job.signal?.removeEventListener('abort', abort)
          slot.child.off('message', message)
          slot.child.off('error', errorHandler)
          slot.child.off('exit', exit)
          slot.child.off('close', exit)
          if (error) reject(new OcrPoolError(error)); else resolve(text)
        }
        const abort = () => finish('request_aborted')
        const exit = () => finish('ocr_failure')
        const errorHandler = () => finish('ocr_failure')
        const message = (result) => {
          if (result?.kind !== 'result' || typeof result.text !== 'string' || result.text.length > 131072 ||
              !Number.isSafeInteger(result.memoryBytes) || result.memoryBytes <= 0) { finish('ocr_failure'); return }
          slot.memoryBytes = result.memoryBytes
          finish(undefined, result.text)
        }
        // Starts before sending the first job: covers spawn/init/language/recognition.
        const timer = setTimeout(() => finish('ocr_timeout'), this.options.timeoutMs)
        slot.child.on('message', message)
        slot.child.once('error', errorHandler)
        slot.child.once('exit', exit)
        slot.child.once('close', exit)
        job.signal?.addEventListener('abort', abort, { once: true })
        if (job.signal?.aborted) { abort(); return }
        if (slot.exited || !slot.child.connected) { finish('ocr_failure'); return }
        slot.child.send({ data: job.data }, error => { if (error) finish('ocr_failure') })
      })
      this.completed++
      job.resolve(text)
    } catch (error) {
      failure = error
      try { await this.stop(slot) } catch { failure = new OcrPoolError('ocr_failure') }
      job.reject(failure)
    } finally {
      slot.busy = false
      if (!failure && !slot.exited && !this.closed) {
        slot.timer = setTimeout(() => { void this.stop(slot).catch(() => {}) }, this.options.idleMs)
        slot.timer.unref()
      }
      this.pump()
    }
  }

  async close() {
    this.closed = true
    for (const job of this.waiting.splice(0)) { this.clearWaiting(job); job.reject(new OcrPoolError('ocr_failure')) }
    const results = await Promise.allSettled([...this.slots].map(slot => this.stop(slot)))
    if (results.some(result => result.status === 'rejected')) throw new OcrPoolError('ocr_failure')
  }
}
