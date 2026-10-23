import http from 'node:http'
import net from 'node:net'
import { resolve } from 'node:path'
import { expect } from '@playwright/test'
import { spawnOwnedNodeProcess, stopOwnedNodeProcess } from '../../../support/process-tree.mjs'

export function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, release: () => resolve() }
}
async function freePort() {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = (server.address() as net.AddressInfo).port
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}

/** All listeners/processes are private, loopback and stopped by identity, never by port. */
export class IntentHttpHarness {
  readonly calls = { put: 0, remove: 0, lostStatus: 0 }
  failDeletes = false
  loseNextPost = false
  urls: string[] = []
  lossURL = ''
  storageEndpoint = ''
  private gate?: { written: ReturnType<typeof deferred>; ack: ReturnType<typeof deferred> }
  private children: Array<ReturnType<typeof spawnOwnedNodeProcess> | undefined> = []
  private storageProxy?: http.Server
  private lossProxy?: http.Server
  constructor(private readonly targetStorage: URL) {}

  holdNextPut() {
    const gate = { written: deferred(), ack: deferred() }
    this.gate = gate
    return { written: gate.written.promise, release: () => gate.ack.release() }
  }

  async start() {
    this.storageProxy = http.createServer((request, response) => {
      if (request.method === 'DELETE' && this.failDeletes) { request.resume(); response.writeHead(503, { 'Content-Type': 'application/xml' }); response.end('<Error><Code>ServiceUnavailable</Code></Error>'); return }
      const outgoing = http.request({ hostname: this.targetStorage.hostname, port: this.targetStorage.port, method: request.method, path: request.url, headers: request.headers }, upstream => {
        const chunks: Buffer[] = []; let length = 0
        upstream.on('data', (chunk: Buffer) => { length += chunk.length; if (length > 1024 * 1024) { upstream.destroy(); response.destroy() } else chunks.push(chunk) })
        upstream.on('error', () => response.destroy())
        upstream.on('end', () => {
          if (request.method === 'PUT' && upstream.statusCode === 200) this.calls.put++
          if (request.method === 'DELETE' && upstream.statusCode === 204) this.calls.remove++
          const send = () => { if (!response.destroyed) { response.writeHead(upstream.statusCode ?? 502, upstream.headers); response.end(Buffer.concat(chunks)) } }
          const gate = request.method === 'PUT' && upstream.statusCode === 200 ? this.gate : undefined
          if (gate) { this.gate = undefined; gate.written.release(); void gate.ack.promise.then(send) }
          else send()
        })
      })
      outgoing.on('error', () => { if (!response.destroyed) { response.writeHead(502); response.end() } })
      response.on('close', () => outgoing.destroy())
      request.pipe(outgoing)
    })
    await new Promise<void>(resolve => this.storageProxy!.listen(0, '127.0.0.1', resolve))
    this.storageEndpoint = `http://127.0.0.1:${(this.storageProxy.address() as net.AddressInfo).port}`
    this.urls = [`http://127.0.0.1:${await freePort()}`, `http://127.0.0.1:${await freePort()}`]
    for (const [index, url] of this.urls.entries()) {
      const child = spawnOwnedNodeProcess([resolve('node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', new URL(url).port], {
        env: { ...process.env, NODE_ENV: 'production', AUTH_URL: url, AUTH_TRUST_HOST: 'true', S3_ENDPOINT: this.storageEndpoint, NEXT_TELEMETRY_DISABLED: '1' },
      })
      this.children[index] = child
      // Raw framework logs can contain upstream data; do not retain or publish them.
      child.stdout!.resume(); child.stderr!.resume()
      await expect.poll(async () => {
        if (child.exitCode !== null) throw new Error('Owned LE-03 app exited during startup')
        try { return (await fetch(`${url}/api/auth/csrf`, { signal: AbortSignal.timeout(1000) })).status }
        catch { return 0 }
      }, { timeout: 20_000 }).toBe(200)
    }
    this.lossProxy = http.createServer((request, response) => {
      const lose = this.loseNextPost && request.method === 'POST' && request.url === '/api/expense-notes'
      if (lose) this.loseNextPost = false
      const outgoing = http.request({ hostname: '127.0.0.1', port: new URL(this.urls[0]).port, method: request.method, path: request.url, headers: request.headers }, upstream => {
        if (lose) {
          upstream.resume()
          upstream.on('end', () => { this.calls.lostStatus = upstream.statusCode ?? 0; response.destroy() })
        } else { response.writeHead(upstream.statusCode ?? 502, upstream.headers); upstream.pipe(response) }
        upstream.on('error', () => response.destroy())
      })
      outgoing.on('error', () => response.destroy())
      response.on('close', () => outgoing.destroy())
      request.pipe(outgoing)
    })
    await new Promise<void>(resolve => this.lossProxy!.listen(0, '127.0.0.1', resolve))
    this.lossURL = `http://127.0.0.1:${(this.lossProxy.address() as net.AddressInfo).port}`
  }

  async stopApp(index: number) {
    const child = this.children[index]
    if (child) { await stopOwnedNodeProcess(child); this.children[index] = undefined }
  }
  async stop() {
    this.gate?.ack.release()
    for (let index = 0; index < this.children.length; index++) await this.stopApp(index)
    for (const server of [this.lossProxy, this.storageProxy]) {
      server?.closeAllConnections()
      if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()))
    }
  }
}
