import { expect, it } from 'vitest'
import fixtures from '../../../fixtures/leandro/LE-07/responses.json'
import { assertResponse, assertSchema } from '../../../contracts/leandro/LE-10/openapi'

it('publishes executable first/last/empty and off-page manager fixtures against OpenAPI 4.1', () => {
  const headers = { 'content-type': 'application/json', 'x-request-id': '11111111-1111-4111-8111-111111111111', 'x-pagination-mode': 'paged' }
  for (const [name, body] of Object.entries(fixtures)) {
    const schema = name.startsWith('expense') ? 'ExpensePage' : 'DirectoryPage'
    assertSchema({ $ref: `#/components/schemas/${schema}` }, body)
    assertResponse(name.startsWith('expense') ? '/api/manager/expense-notes' : '/api/hr/users', 'get', 200, headers, body)
  }
  expect(fixtures.expenseFirst.items).toHaveLength(20)
  expect(fixtures.expenseLast.items).toHaveLength(5)
  expect(fixtures.expenseBeyondEnd.items).toHaveLength(0)
})
it('rejects incorrect envelope totals, private fields and a monetary directory total', () => {
  for (const body of [
    { ...fixtures.expenseFirst, totals: { ...fixtures.expenseFirst.totals, amount: '1039.50' } },
    { ...fixtures.expenseFirst, pagination: { ...fixtures.expenseFirst.pagination, pageSize: 101 } },
    { ...fixtures.expenseFirst, items: [{ ...fixtures.expenseFirst.items[0], companyId: 'private' }] },
  ]) expect(() => assertSchema({ $ref: '#/components/schemas/ExpensePage' }, body)).toThrow()
  expect(() => assertSchema({ $ref: '#/components/schemas/DirectoryPage' }, { ...fixtures.directorySearch, totals: { ...fixtures.directorySearch.totals, amount: 0 } })).toThrow()
  expect(() => assertSchema({ $ref: '#/components/schemas/DirectoryPage' }, { ...fixtures.directorySearch, selectedManager: { ...fixtures.directorySearch.selectedManager, password_hash: 'private' } })).toThrow()
})
