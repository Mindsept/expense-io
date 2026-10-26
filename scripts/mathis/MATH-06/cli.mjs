import { readPrivateConfig, safeError, refuse } from './guards.mjs'

function argumentsFor(action, args) {
  const allowed = action === 'doctor' ? ['config'] : action === 'backup' ? ['config', 'output', 'confirm-stopped-synthetic'] : action === 'restore' ? ['config', 'archive', 'output', 'app-port', 'auth-port', 'db-port', 's3-port'] : action === 'prepare' ? ['output', 'app-port', 'auth-port', 'db-port', 's3-port'] : action === 'down' ? ['config', 'confirm-disposable'] : []
  if (!allowed.length) refuse('unknown_operation')
  const result = {}
  while (args.length) {
    const token = args.shift(), key = token?.startsWith('--') ? token.slice(2) : ''
    if (!allowed.includes(key) || result[key] !== undefined) refuse('unexpected_argument')
    if (key.startsWith('confirm-')) result[key] = true
    else { const value = args.shift(); if (!value || value.startsWith('--')) refuse('missing_argument'); result[key] = value }
  }
  return result
}
export async function operationsCli(action, args = process.argv.slice(2)) {
  try {
    const options = argumentsFor(action, [...args])
    const config = options.config ? await readPrivateConfig(options.config) : undefined
    if (action === 'doctor') {
      const { doctor } = await import('./doctor.mjs'), report = await doctor(config || process.env)
      console.info(JSON.stringify(report, null, 2)); if (!report.ok) process.exitCode = 1; return
    }
    const { backup, restore, prepareDemo, downDemo } = await import('./transfer.mjs')
    const defaults = action === 'prepare' ? { app: 3215, auth: 3216, db: 55440, s3: 45740 } : { app: 3225, auth: 3226, db: 55441, s3: 45741 }
    const ports = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, options[`${key}-port`] || value]))
    const result = action === 'backup' ? await backup(config, options.output, options['confirm-stopped-synthetic'])
      : action === 'restore' ? await restore(config, options.archive, options.output, ports)
        : action === 'prepare' ? await prepareDemo(options.output, ports) : await downDemo(config, options['confirm-disposable'])
    console.info(JSON.stringify(result, null, 2))
  } catch (error) { console.error(safeError(error)); process.exitCode = 1 }
}
