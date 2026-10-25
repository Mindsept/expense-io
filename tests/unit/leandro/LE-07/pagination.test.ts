import { expect, it, vi } from 'vitest'
import { directoryFilters, listResponse, orderBy, queryPage, readDirectoryOrder, readExpenseOrder, readPagination } from '@/lib/pagination'

it('bounds every call and defaults omitted page parameters', () => {
  expect(readPagination(new URLSearchParams())).toEqual({ page: 1, pageSize: 20, offset: 0 })
  expect(readPagination(new URLSearchParams('page=2'))).toEqual({ page: 2, pageSize: 20, offset: 20 })
  expect(readPagination(new URLSearchParams('pageSize=100'))).toEqual({ page: 1, pageSize: 100, offset: 0 })
})
it.each(['page=0','page=-1','page=1.2','page=1e2','page=+1','page=01','page=','page=2x','page=9007199254740992','page=9007199254740991&pageSize=100','pageSize=0','pageSize=101','pageSize=','page=1&page=2','pageSize=20&pageSize=20'])('rejects invalid or ambiguous pagination %s', query => {
  expect(() => readPagination(new URLSearchParams(query))).toThrowError(expect.objectContaining({ code: 'validation' }))
})
it.each(['created_at DESC','created_at ASC','amount DESC','amount ASC','expense_date DESC','expense_date ASC'])('uses the identifier as deterministic secondary order for %s', sort => {
  expect(orderBy(readExpenseOrder(new URLSearchParams({ sort }), 'created_at DESC'))).toBe(`${sort}, id ${sort.split(' ')[1]}`)
})
it('preserves distinct legacy defaults and rejects untrusted order fragments', () => {
  expect(orderBy(readExpenseOrder(new URLSearchParams(), 'created_at ASC'))).toBe('created_at ASC, id ASC')
  expect(orderBy(readExpenseOrder(new URLSearchParams(), 'created_at DESC'))).toBe('created_at DESC, id DESC')
  expect(orderBy(readDirectoryOrder(new URLSearchParams()), 'p')).toBe('p.name ASC, p.id ASC')
  for (const sort of ['__proto__','created_at desc','amount DESC; SELECT 1']) expect(() => readExpenseOrder(new URLSearchParams({ sort }), 'created_at DESC')).toThrow()
  expect(() => readDirectoryOrder(new URLSearchParams('sort=amount+ASC'))).toThrow()
  expect(() => readExpenseOrder(new URLSearchParams('sort=&sort='), 'created_at ASC')).toThrow()
})
it('binds global search literally and bounds the query and selected identity', () => {
  expect(directoryFilters(new URLSearchParams({ q: '  %_\\ ', role: 'manager' }))).toMatchObject({ q: '%_\\', search: '%\\%\\_\\\\%', role: 'manager' })
  for (const query of ['q=one&q=two', 'q=%00', `q=${'x'.repeat(121)}`, 'role=hr_admin','role=manager&role=manager','selectedManagerId=invalid','selectedManagerId=']) {
    expect(() => directoryFilters(new URLSearchParams(query))).toThrowError(expect.objectContaining({ code: 'validation' }))
  }
})
it('queries one shared filtered snapshot for rows and full totals, with bound size/offset and empty-page metadata', async () => {
  const query = vi.fn().mockResolvedValue({ rows: [{ items: [], total_count: '45', total_cents: '103950' }] })
  const page = { page: 4, pageSize: 20, offset: 60 }
  const result = await queryPage({ query }, { sourceSql: 'SELECT * FROM expense_notes WHERE user_id=$1', values: ['actor'], order: { column: 'created_at', direction: 'ASC' }, page, monetary: true })
  expect(query).toHaveBeenCalledOnce()
  const [sql, values] = query.mock.calls[0]
  expect(sql).toContain('WITH filtered AS (SELECT * FROM expense_notes WHERE user_id=$1)')
  expect(sql).toContain('FROM filtered ORDER BY created_at ASC, id ASC LIMIT $2 OFFSET $3')
  expect(sql).toContain('jsonb_agg(to_jsonb(p) ORDER BY p.created_at ASC, p.id ASC)')
  expect(values).toEqual(['actor', 20, 60])
  expect(result).toMatchObject({ rows: [], pagination: { page: 4, pageSize: 20, totalItems: 45 }, totals: { count: 45, amount: 1039.5, scope: 'filtered' } })
})
it('has count-only totals for the directory and keeps selection separate from its filtered page', async () => {
  const selected = { id: 'selected', name: 'Outside query', role: 'manager', isActive: true, isEligible: true }
  const query = vi.fn().mockResolvedValue({ rows: [{ items: [], total_count: '0', selected_manager: selected }] })
  const result = await queryPage({ query }, { sourceSql: 'SELECT id,name FROM users WHERE company_id=$1 AND name ILIKE $2', values: ['company','%literal%','selected'],
    order: { column: 'name', direction: 'ASC' }, page: { page: 1, pageSize: 20, offset: 0 }, selectionSql: 'SELECT NULL WHERE $3 IS NULL' })
  expect(result.totals).toEqual({ count: 0, scope: 'filtered' })
  expect(result.selectedManager).toEqual(selected)
  expect(query.mock.calls[0][1]).toEqual(['company','%literal%','selected',20,0])
})
it.each([
  { items: [], total_count: '-1', total_cents: '0' }, { items: [], total_count: '9007199254740992', total_cents: '0' },
  { items: [], total_count: '1', total_cents: '-1' }, { items: [], total_count: '1', total_cents: '9007199254740992' },
  { items: 'bad', total_count: '1', total_cents: '0' },
])('refuses corrupt or unrepresentable aggregates instead of inventing a total', async row => {
  await expect(queryPage({ query: vi.fn().mockResolvedValue({ rows: [row] }) }, { sourceSql: 'SELECT * FROM expense_notes', values: [], order: { column: 'amount', direction: 'DESC' }, page: { page: 1, pageSize: 20, offset: 0 }, monetary: true })).rejects.toThrow()
})
it('marks every list as paged and prevents caching of personal data', async () => {
  const body = { items: [] }
  const response = listResponse(body)
  expect(response.headers.get('x-pagination-mode')).toBe('paged')
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual(body)
})
