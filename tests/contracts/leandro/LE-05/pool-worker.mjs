/* Synthetic owned process fault fixture, never loaded by production config. */
import { Worker } from 'node:worker_threads'
let nested
process.on('disconnect', () => process.exit(0))
process.on('message', message => {
  const command = message.data.toString()
  if (command === 'hang') {
    nested = new Worker('while (true) {}', { eval: true })
    return
  }
  if (command === 'error') { process.send({ kind: 'error' }); return }
  if (command === 'exit') { process.exit(2); return }
  if (command === 'stall-init') { while (true) {} }
  process.send({ kind: 'result', text: 'TOTAL 12,30', memoryBytes: process.memoryUsage().rss })
})
process.on('exit', () => { void nested })
