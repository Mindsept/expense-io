import { once } from 'node:events'
import { expect, it } from 'vitest'
import { spawnOwnedNodeProcess, stopOwnedNodeProcess } from '../../../support/process-tree.mjs'

function running(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
    throw error
  }
}

it('stops its own process tree while leaving another Node process running', async () => {
  const tree = spawnOwnedNodeProcess(['-e', `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore', windowsHide: true
    });
    child.once('spawn', () => console.log(JSON.stringify({ childPid: child.pid })));
    setInterval(() => {}, 1000);
  `])
  const announced = once(tree.stdout, 'data')
  const other = spawnOwnedNodeProcess(['-e', 'console.log("ready"); setInterval(() => {}, 1000)'])
  const otherReady = once(other.stdout, 'data')
  try {
    const [chunk] = await announced
    await otherReady
    const { childPid } = JSON.parse(chunk.toString()) as { childPid: number }
    expect(running(childPid)).toBe(true)
    expect(running(other.pid!)).toBe(true)
    await stopOwnedNodeProcess(tree)
    await expect.poll(() => running(childPid), { timeout: 5_000 }).toBe(false)
    expect(running(other.pid!)).toBe(true)
    await stopOwnedNodeProcess(tree) // Repeated cleanup must remain harmless.
  } finally {
    await Promise.all([stopOwnedNodeProcess(tree), stopOwnedNodeProcess(other)])
  }
}, 20_000)
