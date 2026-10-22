import { execFile, spawn } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

const executeFile = promisify(execFile)
/** @type {WeakSet<import('node:child_process').ChildProcess>} */
const owned = new WeakSet()

/**
 * Launch a test-owned executable with no shell; only this returned tree may be stopped.
 * Windows .cmd scripts must be invoked through their actual executable/Node CLI.
 * @param {string} command
 * @param {readonly string[]} args
 * @param {Pick<import('node:child_process').SpawnOptions, 'cwd' | 'env'>} [options]
 */
export function spawnOwnedProcess(command, args, options = {}) {
  const child = spawn(command, [...args], {
    ...options,
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  owned.add(child)
  return child
}

/**
 * @param {readonly string[]} args
 * @param {Pick<import('node:child_process').SpawnOptions, 'cwd' | 'env'>} [options]
 */
export function spawnOwnedNodeProcess(args, options = {}) {
  return spawnOwnedProcess(process.execPath, args, options)
}

/** @param {import('node:child_process').ChildProcess} child */
function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null
}

/**
 * @param {import('node:child_process').ChildProcess} child
 * @param {number} milliseconds
 * @returns {Promise<boolean>}
 */
function waitForExit(child, milliseconds) {
  if (hasExited(child)) return Promise.resolve(true)
  return new Promise((resolve) => {
    const onExit = () => finish(true)
    const timer = setTimeout(() => finish(false), milliseconds)
    /** @param {boolean} exited */
    function finish(exited) {
      clearTimeout(timer)
      child.off('exit', onExit)
      resolve(exited)
    }
    child.once('exit', onExit)
  })
}

/**
 * @param {number} pid
 * @param {NodeJS.Signals} signal
 */
function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal)
  } catch (error) {
    // ESRCH means the private group is already gone, not a reason to target a
    // different PID. Permission errors and other failures must remain visible.
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ESRCH') throw error
  }
}

/**
 * Never select a process by executable name or by an application port.
 * @param {import('node:child_process').ChildProcess} child
 * @returns {Promise<void>}
 */
export async function stopOwnedNodeProcess(child) {
  if (!owned.has(child)) throw new Error('Refusing to stop a process not created by this test helper.')
  if (hasExited(child)) return
  const pid = child.pid
  if (!pid || !Number.isSafeInteger(pid) || pid <= 0) throw new Error('The test process has no valid PID.')

  if (process.platform === 'win32') {
    // /T includes the Next dev child. No shell, no image-name-wide taskkill,
    // and the root PID comes only from the still-running process we spawned.
    const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')
    try {
      await executeFile(taskkill, ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 })
    } catch (error) {
      // The process can naturally exit between the check and taskkill.
      if (!hasExited(child)) throw new Error('Could not stop the owned Windows test process tree.', { cause: error })
    }
  } else {
    signalGroup(pid, 'SIGTERM')
    await waitForExit(child, 5_000)
    // The root can exit before a child that ignores SIGTERM. Clear the owned
    // group as well, rather than assuming root exit proves descendant exit.
    signalGroup(pid, 'SIGKILL')
  }
  if (!await waitForExit(child, 5_000)) throw new Error('The owned test process did not exit after termination.')
}
