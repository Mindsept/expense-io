import { describe, expect, it } from 'vitest'
import { pageCount, pageRange, parsePagedList } from '@/utils/paged-list'

describe('paged list contract', () => {
  it('accepts the notes page envelope and preserves server totals', () => {
    const result = parsePagedList<{ id: string }>({
      items: [{ id: 'note-1' }],
      pagination: { page: 2, pageSize: 10, totalItems: 25 },
      totals: { amount: 321.75, count: 25, scope: 'filtered' },
    }, true)

    expect(result.items).toEqual([{ id: 'note-1' }])
    expect(result.pagination).toEqual({ page: 2, pageSize: 10, totalItems: 25 })
    expect(result.totals).toEqual({ amount: 321.75, count: 25, scope: 'filtered' })
  })

  it('accepts directory totals without a fabricated amount', () => {
    expect(parsePagedList({
      items: [], pagination: { page: 1, pageSize: 20, totalItems: 0 }, totals: { count: 0, scope: 'filtered' },
    }, false).totals).toEqual({ count: 0, scope: 'filtered' })
  })

  it.each([
    null,
    [],
    { items: [], pagination: { page: 0, pageSize: 20, totalItems: 5 }, totals: { count: 5, scope: 'filtered' } },
    { items: [], pagination: { page: 1, pageSize: 20, totalItems: 5 }, totals: { count: 5, scope: 'all' } },
    { items: [], pagination: { page: 1, pageSize: 20, totalItems: 5 }, totals: { amount: 0, count: 5, scope: 'filtered' } },
  ])('rejects an invalid envelope: %j', (value) => {
    expect(() => parsePagedList(value, false)).toThrow('Invalid paginated list')
  })

  it('calculates bounded pages and visible ranges for empty, full and last pages', () => {
    expect(pageCount(0, 10)).toBe(1)
    expect(pageCount(25, 10)).toBe(3)
    expect(pageRange(1, 10, 25)).toEqual({ start: 1, end: 10 })
    expect(pageRange(3, 10, 25)).toEqual({ start: 21, end: 25 })
    expect(pageRange(1, 10, 0)).toEqual({ start: 0, end: 0 })
  })
})
