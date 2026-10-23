import { createDemoInbox } from './enrollment-demo-inbox.mjs'
  try {
    const port = Number(process.env.ENROLLMENT_DEMO_PORT)
    if (process.argv.length !== 3 || process.argv[2] !== '--isolated' || process.env.ARLA_TEST_ENV !== 'isolated' || !Number.isSafeInteger(port) || port < 1024 || port > 65535 || port === 3000) throw Error('Explicit isolated mode and dedicated port required.')
    const server = createDemoInbox({ origin:process.env.AUTH_URL,bearer:process.env.ENROLLMENT_DELIVERY_BEARER })
    server.listen(port,'127.0.0.1',() => console.log('Synthetic invitation inbox ready on the configured loopback port. No real email is sent.'))
    server.on('error',() => { console.error('Synthetic inbox could not start.'); process.exitCode=1 })
    for (const signal of ['SIGINT','SIGTERM']) process.once(signal,() => { server.closeAllConnections(); server.close() })
  } catch { console.error('Synthetic inbox requires isolated loopback configuration. No email was sent.'); process.exitCode=1 }
