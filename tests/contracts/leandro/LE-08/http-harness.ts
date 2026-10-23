import http from 'node:http'
import net from 'node:net'
import { resolve } from 'node:path'
import { expect } from '@playwright/test'
import { spawnOwnedNodeProcess, stopOwnedNodeProcess } from '../../../support/process-tree.mjs'
import { sanitizeDiagnostic } from '../../../../src/observability/registry.mjs'

/** All servers are private loopback; only sanitized, bounded diagnostic lines are retained. */
export class DiagnosticHarness {
  url = ''
  failPuts = false
  readonly events: Array<Record<string, unknown>> = []
  private child?: ReturnType<typeof spawnOwnedNodeProcess>
  private proxy?: http.Server
  constructor(private readonly storage: URL) {}
  async start(settings: Record<string, string> = {}) {
    this.proxy = http.createServer((request, response) => {
      if (this.failPuts && request.method === 'PUT') {
        request.resume(); response.writeHead(503, { 'Content-Type': 'application/xml' }); response.end('<Error><Code>ServiceUnavailable</Code></Error>'); return
      }
      const outgoing = http.request({ hostname: this.storage.hostname, port: this.storage.port, method: request.method, path: request.url, headers: request.headers }, upstream => {
        response.writeHead(upstream.statusCode ?? 502, upstream.headers); upstream.pipe(response)
        upstream.on('error', () => response.destroy())
      })
      outgoing.on('error', () => { response.writeHead(502); response.end() })
      response.on('close', () => outgoing.destroy()); request.pipe(outgoing)
    })
    await new Promise<void>(resolve => this.proxy!.listen(0, '127.0.0.1', resolve))
    const listener = net.createServer()
    await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve))
    const port = (listener.address() as net.AddressInfo).port
    await new Promise<void>(resolve => listener.close(() => resolve()))
    this.url = `http://127.0.0.1:${port}`
    this.child = spawnOwnedNodeProcess([resolve('node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
      env: { ...process.env, ...settings, NODE_ENV: 'production', AUTH_URL: this.url, AUTH_TRUST_HOST: 'true', NEXT_TELEMETRY_DISABLED: '1',
        S3_ENDPOINT: `http://127.0.0.1:${(this.proxy.address() as net.AddressInfo).port}` },
    })
    for (const output of [this.child.stdout!, this.child.stderr!]) {
      let partial = ''
      output.on('data', chunk => {
        for (const [index, line] of String(chunk).split('\n').entries()) {
          if (index === 0) partial += line
          else { this.capture(partial); partial = line }
          if (partial.length > 8192) partial = ''
        }
      })
    }
    try {
      await expect.poll(async () => {
        if (this.child!.exitCode !== null) throw new Error('Owned LE-08 app failed to start')
        try { return (await fetch(`${this.url}/api/auth/csrf`, { signal: AbortSignal.timeout(1000) })).status } catch { return 0 }
      }, { timeout: 20_000 }).toBe(200)
    } catch (error) { await this.stop(); throw error }
  }
  private capture(line: string) {
    if (line.length > 8192 || this.events.length >= 1000) return
    try {
      const raw = JSON.parse(line), event = sanitizeDiagnostic(raw)
      if (event) this.events.push({ ...event, ...(raw.schema === 'expense.phase.v1' ? { schema: raw.schema } : {}) })
    } catch { /* Ignore raw framework output without retaining it. */ }
  }
  exportLines() { return this.events.map(event => JSON.stringify(event)).join('\n') }
  async stop() {
    if (this.child) await stopOwnedNodeProcess(this.child)
    if (this.proxy) { this.proxy.closeAllConnections(); await new Promise<void>(resolve => this.proxy!.close(() => resolve())) }
  }
}
