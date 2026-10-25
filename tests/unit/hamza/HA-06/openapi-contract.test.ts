import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ApiError, withApiHandler } from '@/lib/errors'
import { assertResponse, assertSchema, contract, methods } from '../../../contracts/leandro/LE-10/openapi'

const merged = contract.paths
function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = path.join(directory, entry.name)
    return entry.isDirectory() ? routeFiles(name) : entry.name === 'route.ts' ? [name] : []
  })
}

describe('HA-06 delivered OpenAPI lifecycle contract', () => {
  it('publishes an exact inventory of all 17 route files and methods, retaining every delivered operation', () => {
    const operations = Object.entries(merged).flatMap(([url, item]) => methods.filter(method => item[method]).map(method => ({ url, method, op: item[method] as { 'x-source': string; operationId: string } })))
    const files = routeFiles('src/app/api').sort()
    expect(files).toHaveLength(17)
    expect([...new Set(operations.map(({ op }) => op['x-source']))].sort()).toEqual(files)
    expect(new Set(operations.map(({ op }) => op.operationId)).size).toBe(operations.length)
    for (const file of files) {
      const exported = file.includes('[...nextauth]') ? ['get', 'post'] : [...readFileSync(file, 'utf8').matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g)].map(match => match[1].toLowerCase()).sort()
      expect([...new Set(operations.filter(({ op }) => op['x-source'] === file).map(({ method }) => method))].sort()).toEqual(exported)
    }
  })

  it('validates actual lifecycle shapes and rejects empty, forged and mistyped commands', () => {
    const { UserAccessChange, UserAccess, ValidationStatus } = contract.components.schemas
    for (const schema of [UserAccessChange, UserAccess, ValidationStatus]) assertSchema(schema, schema.example)
    for (const command of [{}, { companyId: 'forged' }, { role: 'admin' }, { isActive: 'false' }]) {
      expect(() => assertSchema(UserAccessChange, command)).toThrow('OpenAPI schema mismatch:')
    }
    assertSchema(UserAccessChange, { role: 'manager', isActive: true })
    expect(() => assertSchema(UserAccess, { ...UserAccess.example as Record<string, unknown>, email: 'private@example.test' })).toThrow()
    expect(() => assertSchema(ValidationStatus, { ...ValidationStatus.example as Record<string, unknown>, status: 'finished' })).toThrow()
  })

  it('documents shared approval-list author metadata while refusing private author fields', () => {
    const note = contract.components.schemas.ExpenseNote.example as Record<string, unknown>
    const items = [{ ...note, author: { id: note.userId, displayName: 'Synthetic author' } }]
    const headers = { 'content-type': 'application/json', 'x-request-id': '33333333-3333-4333-8333-333333333333' }
    const body = { items, pagination: { page: 1, pageSize: 20, totalItems: 1 }, totals: { amount: note.amount, count: 1, scope: 'filtered' } }
    assertResponse('/api/manager/expense-notes', 'get', 200, headers, body)
    expect(() => assertResponse('/api/manager/expense-notes', 'get', 200, headers,
      { ...body, items: [{ ...items[0], author: { ...items[0].author, email: 'private@example.test' } }] })).toThrow()
  })

  it('documents both actual static 409 problems without accepting private error details', async () => {
    const schema = contract.components.schemas.ProblemDetails
    for (const code of ['manager_cycle', 'last_active_hr'] as const) {
      const response = await withApiHandler(new Request('http://localhost/test'), 'test.ha06', async () => { throw new ApiError(code) })
      expect(response.status).toBe(409)
      const body = await response.json()
      assertSchema(schema, body)
      expect(() => assertSchema(schema, { ...body, detail: 'private SQL input' })).toThrow()
    }
  })
})
