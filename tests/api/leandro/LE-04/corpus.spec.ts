import path from 'node:path'
import { createWorker } from 'tesseract.js'
import { test, expect } from '@playwright/test'
import fixtures from '../../../fixtures/leandro/LE-04/images.json'
import { parseReceiptText } from '@/lib/ocr-parser'

test('real French Tesseract output and pure text parsing are measured separately', async () => {
  test.setTimeout(90_000)
  const worker = await createWorker('fra', undefined, { langPath: path.join(process.cwd(), 'tessdata'), cacheMethod: 'none' })
  const observations = []
  try {
    for (const fixture of fixtures) {
      const textResult = parseReceiptText(fixture.lines.join('\n'))
      const { data: { text } } = await worker.recognize(path.join(process.cwd(), 'tests/fixtures/leandro/LE-04/images', `${fixture.id}.png`))
      const result = parseReceiptText(text)
      observations.push({ id: fixture.id, text, result, expected: fixture.expected, parserCorrect: JSON.stringify(textResult) === JSON.stringify(fixture.expected) })
    }
  } finally { await worker.terminate() }
  // Fixtures contain exclusively authored synthetic text, safe to record in test evidence.
  console.log(JSON.stringify({ corpus: 'LE-04 synthetic v1', observations }))
  for (const [index, observation] of observations.entries()) {
    expect(observation.parserCorrect, fixtures[index].id).toBe(true)
    expect(observation.result, fixtures[index].id).toEqual(fixtures[index].expected)
  }
})
