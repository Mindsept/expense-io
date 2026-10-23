import { describe, expect, it, vi } from 'vitest'
import { toExpenseNote } from '@/adapters/expense-note-mapper'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/current-actor', () => ({
  withCurrentActor: async (_role: unknown, operation: (client: unknown, actor: { id: string }) => unknown) => {
    const session = await mocks.auth()
    if (!session?.user) throw new Error('Unexpected unauthenticated DTO fixture')
    return operation({ query: mocks.query }, { id: session.user.id })
  },
}))
vi.mock('@/lib/db', () => ({ withUserScope: async (_id: string, fn: (client: unknown) => unknown) => fn({ query: mocks.query }), getPool: vi.fn() }))
vi.mock('@/lib/storage', () => ({ receiptKeyFor: vi.fn(), uploadReceipt: vi.fn() }))
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/expense-notes/route'

const row = {
  id: 'note', user_id: 'owner', amount: '1234.56', expense_date: '2024-02-29',
  description: 'Taxi', receipt_key: 'receipts/1.png', status: 'pending',
  created_at: new Date('2026-10-21T12:00:00.000Z'),
  password_hash: 'private', email: 'private@example.test',
}

describe('shared expense representation', () => {
  it('keeps the existing public shape and never spreads private columns', () => {
    expect(toExpenseNote(row)).toEqual({
      id: 'note', userId: 'owner', amount: 1234.56, expenseDate: '2024-02-29',
      description: 'Taxi', receiptKey: 'receipts/1.png', status: 'pending',
      createdAt: '2026-10-21T12:00:00.000Z',
    })
  })
  it.each(['UTC', 'America/Los_Angeles', 'Europe/Paris', 'Pacific/Kiritimati'])('preserves the civil day in %s', (tz) => {
    const previous = process.env.TZ
    process.env.TZ = tz
    try { expect(toExpenseNote(row).expenseDate).toBe('2024-02-29') }
    finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous }
  })
  it.each(['12.30', '0.01', '99999999.99', 42.5])('maps decimal %s without truncation', (amount) => {
    expect(toExpenseNote({ ...row, amount }).amount).toBe(Number(amount))
  })
  it('normalizes instants with offsets and explicitly selected author metadata', () => {
    const dto = toExpenseNote({ ...row, created_at: '2026-10-21T14:00:00+02:00', decided_at: '2026-10-22T14:00:00+02:00' }, { id: 'owner', displayName: 'Demo', email: 'private' } as { id: string; displayName: string })
    expect(dto.createdAt).toBe('2026-10-21T12:00:00.000Z')
    expect(dto.decidedAt).toBe('2026-10-22T12:00:00.000Z')
    expect(dto.author).toEqual({ id: 'owner', displayName: 'Demo' })
    expect(toExpenseNote({ ...row, decided_at: null })).not.toHaveProperty('decidedAt')
  })
  it.each(['2023-02-29', '2026-04-31', '0000-01-01', '2026-13-01', '2026-01-00', '2026-1-1', new Date('2026-01-01')])('rejects invalid civil date %s', (expense_date) => {
    expect(() => toExpenseNote({ ...row, expense_date })).toThrow('civil date')
  })
  it.each(['12.34garbage', '1e2', 'NaN', 'Infinity', '12.345', '100000000.00', '-1', '0', NaN, null])('rejects incoherent amount %s', (amount) => {
    expect(() => toExpenseNote({ ...row, amount })).toThrow()
  })
  it.each(['not-a-date', '2026-02-30T12:00:00Z', '2026-10-21T24:00:00Z', '2026-10-21T12:00:00', new Date(NaN), null])('rejects invalid or ambiguous timestamp %s', (created_at) => {
    expect(() => toExpenseNote({ ...row, created_at })).toThrow('timestamp')
  })
  it('does not invent missing fields or states', () => {
    expect(() => toExpenseNote({ ...row, id: undefined })).toThrow()
    expect(() => toExpenseNote({ ...row, status: 'unknown' })).toThrow()
  })
  it('is consumed by the real personal-list handler', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'owner' } })
    mocks.query.mockResolvedValue({ rows: [row] })
    const response = await GET(new NextRequest('http://localhost/api/expense-notes'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([toExpenseNote(row)])
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('WHERE user_id = $1'), ['owner'])
  })
  it('keeps a malformed stored value inside the HTTP error boundary', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'owner' } })
    mocks.query.mockResolvedValue({ rows: [{ ...row, expense_date: 'invalid-private-value' }] })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const response = await GET(new NextRequest('http://localhost/api/expense-notes'))
      expect(response.status).toBe(500)
      const body = await response.text()
      expect(body).not.toContain('invalid-private-value')
      expect(body).not.toContain('Invalid expense row')
    } finally { log.mockRestore() }
  })
})
