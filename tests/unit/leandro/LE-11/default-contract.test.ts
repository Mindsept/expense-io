import { expect, it } from 'vitest'
import { assertResponse, contract } from '../../../contracts/leandro/LE-10/openapi'

const headers = { 'content-type': 'application/json', 'x-request-id': '11111111-1111-4111-8111-111111111111' }
for (const path of ['/api/expense-notes', '/api/manager/expense-notes', '/api/hr/expense-notes', '/api/hr/users']) {
  it(`${path}: accepts the bounded empty page, rejects legacy arrays and incomplete totals`, () => {
    const body = { items: [], pagination: { page: 1, pageSize: 20, totalItems: 0 },
      totals: { ...(path.endsWith('/users') ? {} : { amount: 0 }), count: 0, scope: 'filtered' } }
    assertResponse(path, 'get', 200, headers, body)
    expect(() => assertResponse(path, 'get', 200, headers, [])).toThrow()
    expect(() => assertResponse(path, 'get', 200, headers, { ...body, totals: undefined })).toThrow()
    expect(() => assertResponse(path, 'get', 200, headers, { ...body, pagination: { ...body.pagination, pageSize: 101 } })).toThrow()
  })
}
it('publishes this response break as major version five', () => {
  expect((contract as unknown as { info: { version: string } }).info.version).toBe('5.0.0')
})
