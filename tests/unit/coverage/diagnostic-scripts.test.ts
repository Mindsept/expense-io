import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
const io = vi.hoisted(() => ({ stream: vi.fn(), read: vi.fn(), recognize: vi.fn(), close: vi.fn(), snapshot: vi.fn(), exec: vi.fn(), image: vi.fn(), toFile: vi.fn(), mkdir: vi.fn(), write: vi.fn() }))
vi.mock('node:fs', () => ({ createReadStream: io.stream }))
vi.mock('node:fs/promises', () => ({ readFile: io.read, mkdir: io.mkdir, writeFile: io.write }))
vi.mock('node:child_process', () => ({ execFileSync: io.exec }))
vi.mock('@/lib/ocr-pool.mjs', () => ({ OcrPool: class { recognize = io.recognize; close = io.close; snapshot = io.snapshot } }))
vi.mock('sharp', () => ({ default: io.image }))
const originalArgv = process.argv, originalExit = process.exitCode
beforeEach(() => {
  vi.resetAllMocks(); vi.resetModules(); process.exitCode = 0
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {})
  io.exec.mockReturnValue('test-commit\n')
  io.read.mockImplementation(async file => String(file).endsWith('images.json') ? JSON.stringify(Array.from({ length: 8 }, (_, i) => ({ id: `image-${i}`, lines: ['A & B < C > D'] }))) : Buffer.from('synthetic'))
  io.snapshot.mockReturnValue({ workers: 0, queued: 0, active: 0, stopping: 0, childRssBytes: 0 })
  const image = { png: () => image, jpeg: () => image, webp: () => image, toFile: io.toFile }; io.image.mockReturnValue(image)
})
afterEach(() => { process.argv = originalArgv; process.exitCode = originalExit; vi.restoreAllMocks() })
it('frames diagnostics across chunks, skips malformed and oversized records, and bounds correlation output', async () => {
  const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  process.argv = [process.execPath, 'export.mjs', '--input', 'fixture.jsonl', '--request-id', requestId, '--limit', '1']
  const record = JSON.stringify({ event: 'request.completed', operation: 'expense-notes.list', requestId, status: 200, durationMs: 12 })
  io.stream.mockReturnValue(Readable.from(['not-json\n' + 'x'.repeat(9000), '\n' + record.slice(0, 20), record.slice(20) + '\n' + record]))
  await import('../../../scripts/leandro/LE-08/export.mjs')
  const output = JSON.parse(String(vi.mocked(console.log).mock.calls[0][0]))
  expect(output.mode).toBe('correlation'); expect(output.events).toHaveLength(1); expect(output.truncated).toBe(true)
  expect(output.events[0]).toMatchObject({ requestId, operation: 'expense-notes.list', status: 200 })
  expect(JSON.stringify(output)).not.toContain('not-json')
})
it('exports aggregate diagnostics even with empty or malformed trailing input', async () => {
  process.argv = [process.execPath, 'export.mjs', '--input', 'fixture.jsonl']; io.stream.mockReturnValue(Readable.from(['{}\ninvalid']))
  await import('../../../scripts/leandro/LE-08/export.mjs')
  expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0][0])).mode).toBe('aggregate')
})
it.each([[], ['--input'], ['--unknown', 'x'], ['--input', 'x', '--input', 'y'], ['--input', 'x', '--limit', '0'], ['--input', 'x', '--request-id', 'bad']].map(args => ({ args })))('rejects diagnostic options $args', async ({ args }) => {
  process.argv = [process.execPath, 'export.mjs', ...args]; await import('../../../scripts/leandro/LE-08/export.mjs'); expect(process.exitCode).toBe(1); expect(io.stream).not.toHaveBeenCalled()
})
it.each(['ok', 'busy', 'failure', 'capacity', 'corpus'])('measures bounded OCR scenarios and reports %s', async fault => {
  if (fault === 'busy' || fault === 'failure') io.recognize.mockRejectedValue({ code: fault === 'busy' ? 'ocr_busy' : 'unexpected' })
  if (fault === 'capacity') io.snapshot.mockReturnValue({ workers: 2, queued: 0, active: 0, stopping: 0, childRssBytes: 0 })
  if (fault === 'corpus') io.read.mockResolvedValue('[]')
  await import('../../../scripts/leandro/LE-06/measure.mjs')
  expect(process.exitCode).toBe(['failure', 'capacity', 'corpus'].includes(fault) ? 1 : 0)
  if (fault === 'ok' || fault === 'busy' || fault === 'failure') {
    const output = JSON.parse(String(vi.mocked(console.log).mock.calls[0][0]))
    expect(output.scenarios.map((s: { requests: number }) => s.requests)).toEqual([24, 24, 24])
    expect(output.scenarios[0].counts[fault === 'ok' ? 'success' : fault === 'busy' ? 'ocr_busy' : 'ocr_failure']).toBe(24)
    expect(io.close).toHaveBeenCalledTimes(3)
  }
})
it('records the sequential synthetic OCR sample set and closes its pool', async () => {
  await import('../../../scripts/leandro/LE-05/measure.mjs')
  expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0][0])).requests).toBe(24); expect(io.close).toHaveBeenCalled()
})
it('generates six synthetic receipt formats with a coherent PDF cross-reference table', async () => {
  await import('../../../scripts/leandro/LE-01/generate-receipts.mjs')
  expect(io.toFile).toHaveBeenCalledTimes(5)
  const pdf = String(io.write.mock.calls[0][1]), xref = Number(/startxref\n(\d+)/.exec(pdf)![1])
  expect(Buffer.from(pdf).subarray(xref, xref + 4).toString()).toBe('xref')
  expect(pdf).toContain('/Count 1'); expect(pdf.endsWith('%%EOF\n')).toBe(true)
})
it('escapes synthetic OCR text before generating its SVG images', async () => {
  await import('../../../scripts/leandro/LE-04/generate-corpus.mjs')
  expect(io.toFile).toHaveBeenCalledTimes(8)
  const svg = String(io.image.mock.calls[0][0]); expect(svg).toContain('A &amp; B &lt; C &gt; D'); expect(svg).not.toContain('A & B')
})
