import { createServer } from 'node:http'

/** Synthetic .test delivery only. No SMTP, external request, file or business DB. */
export function createDemoInbox({ origin, bearer }) {
  const url = new URL(origin)
  if (url.protocol !== 'http:' || !['127.0.0.1','localhost'].includes(url.hostname) || !url.port || url.port === '3000' || url.pathname !== '/' || url.search || url.hash || url.username || url.password || typeof bearer !== 'string' || bearer.length < 32 || /[\r\n]/.test(bearer)) throw Error('A dedicated loopback test application and private bearer are required.')
  const messages = []
  const server = createServer({requestTimeout:5000,headersTimeout:5000}, async (request, response) => {
    response.setHeader('Cache-Control','no-store')
    if (request.headers.authorization !== `Bearer ${bearer}`) { response.writeHead(403).end(); return }
    if (request.url !== '/enrollment') { response.writeHead(404).end(); return }
    if (request.method === 'GET') { response.setHeader('Content-Type','application/json'); response.end(JSON.stringify(messages)); return }
    if (request.method !== 'POST') { response.writeHead(405).end(); return }
    if (messages.length >= 100) { response.writeHead(503).end(); return }
    try {
      let body = ''
      for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 8192) { response.writeHead(413).end(); return } }
      const message = JSON.parse(body), link = new URL(message.link)
      if (message.type !== 'expense-io.enrollment.v1' || typeof message.to !== 'string' || !/^[^\s@]+@[^\s@]+\.test$/.test(message.to) || link.origin !== url.origin || link.pathname !== '/signup' || link.search || !/^#[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(link.hash) || !Number.isFinite(Date.parse(message.expiresAt))) { response.writeHead(400).end(); return }
      messages.push(message); response.writeHead(202).end()
    } catch { response.writeHead(400).end() }
  })
  return Object.assign(server,{messages})
}
