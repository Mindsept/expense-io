import { describe, expect, it } from 'vitest'
import { createSubmissionIntent, matchesSubmissionIntent } from '@/utils/submission-intent'

const receipt = { name: 'receipt.png', size: 12, type: 'image/png', lastModified: 1 } as File
const payload = { amount: '12.34', expenseDate: '2026-10-16', description: 'Taxi', receipt }

describe('submission intent', () => {
  it('creates a UUID key and matches an unchanged payload', () => {
    const intent = createSubmissionIntent(payload)

    expect(intent.key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(matchesSubmissionIntent(intent, { ...payload })).toBe(true)
  })

  it('rejects changed fields or a newly selected file', () => {
    const intent = createSubmissionIntent(payload)

    expect(matchesSubmissionIntent(intent, { ...payload, amount: '13.00' })).toBe(false)
    expect(matchesSubmissionIntent(intent, { ...payload, description: 'Train' })).toBe(false)
    expect(matchesSubmissionIntent(intent, { ...payload, receipt: { ...receipt } as File })).toBe(false)
  })

  it('creates a distinct key only for an explicitly new intent', () => {
    expect(createSubmissionIntent(payload).key).not.toBe(createSubmissionIntent(payload).key)
  })
})
