import { afterEach, expect, it, vi } from 'vitest'
import { ConsoleNotificationAdapter } from '@/adapters/ConsoleNotificationAdapter'

afterEach(() => vi.restoreAllMocks())

it.each(['approved', 'rejected'] as const)('simulates %s without logging recipient or expense data', async (decision) => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const recipient = 'private-recipient@example.test\nBearer secret'
  const note = 'private-note-and-receipt-key'
  const eventId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'
  await new ConsoleNotificationAdapter().notifyDecision(recipient, note, decision, { eventId })
  const output = log.mock.calls.flat().join('')
  expect(output).not.toContain(recipient)
  expect(output).not.toContain(note)
  expect(output).not.toContain('secret')
  expect(JSON.parse(output)).toMatchObject({ decision, eventId: eventId.toLowerCase(), outcome: 'simulated' })
  expect(log).toHaveBeenCalledOnce()
})

it('accepts the existing three-argument contract without inventing a delivery event', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  await new ConsoleNotificationAdapter().notifyDecision('recipient', 'note', 'approved')
  expect(JSON.parse(log.mock.calls[0][0])).not.toHaveProperty('eventId')
})

it('does not log arbitrary caller metadata in place of a correlation ID', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  await new ConsoleNotificationAdapter().notifyDecision('recipient', 'note', 'approved', { eventId: 'postgres://private:password@host' })
  expect(log.mock.calls.flat().join('')).not.toContain('password')
  expect(JSON.parse(log.mock.calls[0][0])).not.toHaveProperty('eventId')
})

it('rejects unsupported runtime input without printing it', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  await expect(new ConsoleNotificationAdapter().notifyDecision('recipient', 'note', 'private-input' as 'approved')).rejects.toThrow('Unsupported notification decision.')
  expect(log).not.toHaveBeenCalled()
})
