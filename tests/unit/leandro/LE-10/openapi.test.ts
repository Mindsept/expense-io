import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertResponse, assertSchema, contract, methods, operation, type Operation } from '../../../contracts/leandro/LE-10/openapi'

const note = contract.components.schemas.ExpenseNote.example as Record<string, unknown>
const requestId = '33333333-3333-4333-8333-333333333333'
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'x-request-id': requestId }
const receiptPath = '/api/expense-notes/{id}/receipt-url'
const problem = contract.components.schemas.ProblemDetails.example as Record<string, unknown>
const problemHeaders = { 'content-type': 'application/problem+json', 'cache-control': 'no-store', 'x-request-id': requestId }
function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = path.join(directory, entry.name)
    return entry.isDirectory() ? routeFiles(name) : entry.name === 'route.ts' ? [name] : []
  })
}
const operations = Object.entries(contract.paths).flatMap(([url, item]) => methods.filter(method => item[method]).map(method => ({ url, method, op: item[method] as Operation })))

describe('LE-10 executable delivered contract', () => {
  it('inventories exactly the real route files and exported methods, with no target-only endpoints', () => {
    const files = routeFiles('src/app/api').sort()
    expect(files).toHaveLength(15)
    expect([...new Set(operations.map(({ op }) => op['x-source']))].sort()).toEqual(files)
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const exported = file.includes('[...nextauth]') ? ['get', 'post'] : [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g)].map(match => match[1].toLowerCase()).sort()
      const documented = [...new Set(operations.filter(({ op }) => op['x-source'] === file).map(({ method }) => method))].sort()
      expect(documented, file).toEqual(exported)
      for (const { url } of operations.filter(({ op }) => op['x-source'] === file && !op['x-delegated'])) {
        expect(`src/app${url.replaceAll('{id}', '[id]')}/route.ts`).toBe(file)
      }
    }
    expect(new Set(operations.map(({ op }) => op.operationId)).size).toBe(operations.length)
  })

  it('declares every templated path parameter and compiles all request/response schemas', () => {
    expect(contract.openapi).toBe('3.0.3')
    for (const [name, schema] of Object.entries(contract.components.schemas)) {
      // Compiling happens before body validation; a mismatch is expected for {}.
      if ('example' in schema) assertSchema({ $ref: `#/components/schemas/${name}` }, schema.example)
      else {
        try { assertSchema({ $ref: `#/components/schemas/${name}` }, {}) }
        catch (error) { expect(String(error)).toContain('OpenAPI schema mismatch:') }
      }
    }
    for (const { url, method, op } of operations) {
      const pathParams = [...(contract.paths[url].parameters as Operation['parameters'] ?? []), ...(op.parameters ?? [])].filter(p => p.in === 'path')
      for (const [, parameter] of url.matchAll(/\{([^}]+)\}/g)) expect(pathParams.some(p => p.name === parameter && p.required), `${method} ${url}`).toBe(true)
      for (const media of Object.values(op.requestBody?.content ?? {})) {
        try { assertSchema(media.schema, {}) }
        catch (error) { expect(String(error)).toContain('OpenAPI schema mismatch:') }
      }
    }
  })

  it('accepts the shipped numeric DTO and rejects a string amount (negative control)', () => {
    assertResponse('/api/expense-notes', 'post', 201, jsonHeaders, note)
    expect(() => assertResponse('/api/expense-notes', 'post', 201, jsonHeaders, { ...note, amount: '12.50' })).toThrow('OpenAPI schema mismatch:')
    expect(() => assertResponse('/api/expense-notes', 'get', 200, jsonHeaders, [{ ...note, amount: '12.50' }])).toThrow('OpenAPI schema mismatch:')
  })

  it.each([
    { ...note, expenseDate: '2025-02-29' }, { ...note, id: 'not-a-uuid' },
    { ...note, amount: 0 }, { ...note, status: 'finished' }, { ...note, createdAt: '2026-10-22' },
    { ...note, password_hash: 'must-never-leak' },
  ])('rejects malformed dates, IDs, amounts, statuses and leaked fields', invalid => {
    expect(() => assertResponse('/api/expense-notes', 'post', 201, jsonHeaders, invalid)).toThrow('OpenAPI schema mismatch:')
  })

  it('checks status, static detail, media, required headers and request correlation', () => {
    assertResponse(receiptPath, 'get', 404, problemHeaders, problem)
    for (const wrong of [{ ...problem, status: 403 }, { ...problem, detail: 'SQL/private input' }, { ...problem, requestId: note.id }, { ...problem, url: 'secret' }]) {
      expect(() => assertResponse(receiptPath, 'get', 404, problemHeaders, wrong)).toThrow()
    }
    expect(() => assertResponse(receiptPath, 'get', 404, jsonHeaders, problem)).toThrow()
    expect(() => assertResponse(receiptPath, 'get', 404, { 'content-type': 'application/problem+json' }, problem)).toThrow()
    expect(() => assertResponse(receiptPath, 'get', 202, jsonHeaders, {})).toThrow('Undocumented response status')
    expect(() => assertResponse('/api/future', 'get', 200, jsonHeaders, {})).toThrow('Undocumented operation')
  })

  it('keeps the remaining OCR legacy errors separate from migrated personal responses', () => {
    assertResponse('/api/expense-notes/receipt-suggestion', 'post', 401, jsonHeaders, { error: 'Unauthorized' })
    expect(() => assertResponse('/api/expense-notes/receipt-suggestion', 'post', 401, jsonHeaders, {})).toThrow()
    expect(() => assertResponse('/api/expense-notes', 'get', 401, jsonHeaders, { error: 'Unauthorized' })).toThrow()
    expect(operation('/api/expense-notes', 'get')['x-error-contract']).toBe('problem-details-v1')
  })
})
