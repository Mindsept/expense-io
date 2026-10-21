import { provisionFromEnvironment } from './provision-runtime.mjs'

try {
  if (process.argv.length!==3 || process.argv[2]!=='--apply') throw Error('Explicit --apply required.')
  const chunks=[]; let bytes=0
  for await (const chunk of process.stdin) { bytes+=chunk.length; if (bytes>512) throw Error('Private input too long.'); chunks.push(chunk) }
  // A private one-line password file; never accept a secret on argv or print it.
  const password=Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/,'')
  await provisionFromEnvironment(process.env,password)
  console.log('expense_web provisioned. Configure its private DATABASE_URL separately from the administrator environment.')
} catch { console.error('Runtime role provisioning failed. Check explicit administrator configuration, migration and private password input. No credentials are printed.'); process.exitCode=1 }
