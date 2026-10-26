import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { benchmarkHostMetadata, createCampaignOutput } from '../../../../scripts/mathis/MATH-05/campaign.mjs'

test('simultaneous campaigns preserve both results and the published reference', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'arla-benchmark-test-'))
  try {
    const reference = path.join(root, 'post-rls-20261023', '1000')
    await mkdir(reference, { recursive: true })
    await writeFile(path.join(reference, 'summary.json'), '{"reference":true}\n')
    const date = new Date('2026-10-25T12:34:56.789Z')
    const [first, second] = await Promise.all([
      createCampaignOutput(path.join(root, 'runs'), 1000, date),
      createCampaignOutput(path.join(root, 'runs'), 1000, date),
    ])
    expect(first).not.toBe(second)
    await writeFile(path.join(first, 'summary.json'), '{"outcome":"passed"}')
    await writeFile(path.join(second, 'outcome.json'), '{"outcome":"failed"}')
    expect(await readFile(path.join(first, 'summary.json'), 'utf8')).toBe('{"outcome":"passed"}')
    expect(await readFile(path.join(reference, 'summary.json'), 'utf8')).toBe('{"reference":true}\n')
    expect(await readdir(path.join(root, 'runs'))).toHaveLength(2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('refuses unsupported volume before creating an output directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'arla-benchmark-test-'))
  try {
    // @ts-expect-error Deliberately exercise an invalid caller at the runtime boundary.
    await expect(createCampaignOutput(path.join(root, 'runs'), 42)).rejects.toThrow('Unsupported benchmark volume')
    expect(await readdir(root)).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('host metadata never invents Colima or background applications', () => {
  expect(benchmarkHostMetadata({})).toEqual({
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    otherServices: 'Not inventoried; other host activity is unknown.',
    otherServicesSource: 'not-inventoried',
  })
  expect(benchmarkHostMetadata({ ARLA_BENCH_OTHER_SERVICES: '  Docker Desktop; browser open  ' }))
    .toMatchObject({ otherServices: 'Docker Desktop; browser open', otherServicesSource: 'operator-supplied' })
  expect(benchmarkHostMetadata({ ARLA_BENCH_OTHER_SERVICES: '   ' }).otherServicesSource).toBe('not-inventoried')
})
