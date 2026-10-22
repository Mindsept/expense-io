import { readdirSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

// Named examples pin the owners/levels already delivered. New files are also checked below.
const required = [
  'tests/unit/elyes/EL-01/client-errors.test.ts',
  'tests/unit/hamza/HA-07/errors.test.ts',
  'tests/unit/leandro/LE-12/expense-note.test.ts',
  'tests/unit/mathis/MATH-01/unauthenticated-expenses.test.ts',
  'tests/api/hamza/HA-07/errors.spec.ts',
  'tests/api/leandro/LE-12/expense-note.spec.ts',
  'tests/api/mathis/MATH-01/unauthenticated-expenses.spec.ts',
  'tests/e2e/mathis/MATH-01/roles.smoke.spec.ts',
]
const normalize = file => path.relative(process.cwd(), path.resolve(file)).split(path.sep).join('/')
function collect(args) {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 })
  if (result.status !== 0 || result.error) {
    throw new Error(`Collection failed (${result.status ?? 'timeout/start error'}). Run the documented list command with explicit test settings to inspect the runner error.`)
  }
  return JSON.parse(result.stdout)
}
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = `${directory}/${entry.name}`
    return entry.isDirectory() ? files(file) : /\.(test|spec)\.ts$/.test(entry.name) ? [file] : []
  })
}
function specs(suites = []) {
  return suites.flatMap(suite => [...(suite.specs ?? []), ...specs(suite.suites)])
}

try {
  const unit = collect(['node_modules/vitest/vitest.mjs', 'list', '--json'])
  const api = specs(collect(['node_modules/playwright/cli.js', 'test', '--project=api', '--list', '--reporter=json']).suites)
  const e2e = specs(collect(['node_modules/playwright/cli.js', 'test', '--project=e2e', '--list', '--reporter=json']).suites)
  const collected = new Set([...unit, ...api, ...e2e].map(item => normalize(item.file)))
  const expected = new Set([...required, ...['unit', 'api', 'e2e'].flatMap(level => files(`tests/${level}`))])
  for (const file of expected) {
    if (!collected.has(file)) throw new Error(`Expected test file missing from collection: ${file}`)
  }
  const smoke = e2e.filter(item => normalize(item.file) === 'tests/e2e/mathis/MATH-01/roles.smoke.spec.ts')
  for (const role of ['employee', 'manager', 'hr']) {
    if (!smoke.some(item => item.title === `${role} signs in through the form and opens the authorized screen`)) {
      throw new Error(`Expected MATH-01 ${role} smoke missing from collection.`)
    }
  }
  for (const level of ['unit', 'api', 'e2e']) {
    const group = [...collected].filter(file => file.startsWith(`tests/${level}/`)).sort()
    console.log(`${level}: ${group.length} files; owners: ${[...new Set(group.map(file => file.split('/')[2]))].join(', ')}`)
    for (const file of group) console.log(`  ${file}`)
  }
  console.log('Collection complete. No hooks or tests executed; this is not a passing test run.')
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Test collection failed.')
  process.exitCode = 1
}
