import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'

/**
 * Allocate a fresh directory even for simultaneous runs at the same timestamp.
 * Existing reference campaigns are never opened for writing.
 * @param {string} resultsRoot
 * @param {1000 | 10000} volume
 * @param {Date} [at]
 */
export async function createCampaignOutput(resultsRoot, volume, at = new Date()) {
  if (![1000, 10000].includes(volume)) throw new Error('Unsupported benchmark volume.')
  const stamp = at.toISOString().replace(/[:.]/g, '-')
  await mkdir(resultsRoot, { recursive: true })
  const campaign = await mkdtemp(path.join(resultsRoot, `${stamp}-`))
  const output = path.join(campaign, String(volume))
  await mkdir(output)
  return output
}

/**
 * Record observed timezone and distinguish operator notes from observed facts.
 * @param {Record<string, string | undefined>} [env]
 */
export function benchmarkHostMetadata(env = process.env) {
  const otherServices = env.ARLA_BENCH_OTHER_SERVICES?.trim()
  return {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    otherServices: otherServices || 'Not inventoried; other host activity is unknown.',
    otherServicesSource: otherServices ? 'operator-supplied' : 'not-inventoried',
  }
}
