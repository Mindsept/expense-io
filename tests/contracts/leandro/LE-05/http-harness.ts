import net from 'node:net'
import { resolve } from 'node:path'
import { expect } from '@playwright/test'
import { spawnOwnedNodeProcess, stopOwnedNodeProcess } from '../../../support/process-tree.mjs'

export async function startOcrApp(settings: Record<string, string>) {
  const listener = net.createServer()
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = (listener.address() as net.AddressInfo).port
  await new Promise<void>(resolve => listener.close(() => resolve()))
  const url = `http://127.0.0.1:${port}`
  const child = spawnOwnedNodeProcess([resolve('node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    env: { ...process.env, ...settings, NODE_ENV: 'production', AUTH_URL: url, AUTH_TRUST_HOST: 'true', NEXT_TELEMETRY_DISABLED: '1' },
  })
  child.stdout!.resume(); child.stderr!.resume()
  try {
    await expect.poll(async () => {
      if (child.exitCode !== null) throw new Error('Owned LE-05 app failed to start')
      try { return (await fetch(`${url}/api/auth/csrf`, { signal: AbortSignal.timeout(1000) })).status } catch { return 0 }
    }, { timeout: 20_000 }).toBe(200)
    return { url, stop: () => stopOwnedNodeProcess(child) }
  } catch (error) { await stopOwnedNodeProcess(child); throw error }
}
