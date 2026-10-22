import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Test-only reuse of ESLint's declared, lockfile-pinned Ajv 6 dependency. Resolve
// from ESLint itself, so npm hoisting is not required. No application dependency
// or shared Mathis runner/config change. Fail clearly if ESLint changes validator.
const localRequire = createRequire(resolve('package.json'))
const eslintRequire = createRequire(localRequire.resolve('eslint/package.json'))
const version = eslintRequire('ajv/package.json').version as string
if (!version.startsWith('6.')) throw new Error('LE-10 needs review of the locked ESLint/Ajv integration before changing validator major.')
type Schema = Record<string, unknown>
type Validate = ((body: unknown) => boolean) & { errors?: unknown }
const Ajv = eslintRequire('ajv') as new (options: Schema) => {
  addFormat(name: string, format: RegExp): void
  addSchema(schema: Schema, key: string): void
  compile(schema: Schema): Validate
  errorsText(errors: unknown): string
}
const ajv = new Ajv({ allErrors: true, jsonPointers: true, nullable: true, format: 'full', strictKeywords: true })
ajv.addFormat('binary', /^[\s\S]*$/)
ajv.addFormat('password', /^[\s\S]*$/)

export const contract = JSON.parse(readFileSync(resolve('docs/openapi/expense-io.v1.json'), 'utf8')) as {
  openapi: string
  info: { version: string }
  paths: Record<string, Record<string, unknown>>
  components: { schemas: Record<string, Schema>; responses: Record<string, ResponseSpec> }
}
const root = 'urn:expense-io:openapi:v1'
// Only Schema Objects are sent to Ajv. Rewrite local component references into
// draft-07 definitions; OpenAPI metadata/response objects are not JSON Schemas.
function jsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonSchema)
  if (value !== null && typeof value === 'object') {
    // Example data is an annotation, not a schema (an example's id is not $id).
    const schema = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'example').map(([key, child]) => [key, key === '$ref' && typeof child === 'string'
      ? child.replace('#/components/schemas/', `${root}#/definitions/`)
      : jsonSchema(child)]))
    // OAS 3.0 uses draft-04 boolean bounds; Ajv's draft-07 uses numeric bounds.
    for (const bound of ['Minimum', 'Maximum']) {
      const key = `exclusive${bound}`
      const inclusive = bound.toLowerCase()
      if (typeof schema[key] === 'boolean') {
        if (schema[key]) {
          if (typeof schema[inclusive] !== 'number') throw new Error('Exclusive OpenAPI bound requires its numeric bound')
          schema[key] = schema[inclusive]
          delete schema[inclusive]
        } else delete schema[key]
      }
    }
    return schema
  }
  return value
}
ajv.addSchema({ definitions: jsonSchema(contract.components.schemas) }, root)

export interface ResponseSpec {
  $ref?: string
  headers?: Record<string, { required?: boolean; schema: Schema }>
  content?: Record<string, { schema: Schema }>
}
export interface Operation {
  operationId: string
  'x-source': string
  'x-delegated'?: boolean
  'x-error-contract'?: string
  parameters?: Array<{ name: string; in: string; required?: boolean; schema: Schema }>
  requestBody?: { content: Record<string, { schema: Schema }> }
  responses: Record<string, ResponseSpec>
}
export const methods = ['get', 'post', 'put', 'patch', 'delete'] as const
export function operation(path: string, method: string): Operation {
  const result = contract.paths[path]?.[method.toLowerCase()]
  if (!result) throw new Error(`Undocumented operation: ${method} ${path}`)
  return result as Operation
}
const validators = new Map<string, Validate>()
export function assertSchema(schema: Schema, body: unknown): void {
  const key = JSON.stringify(schema)
  let validate = validators.get(key)
  if (!validate) {
    validate = ajv.compile(jsonSchema(schema) as Schema)
    validators.set(key, validate)
  }
  if (!validate(body)) {
    // Diagnostics contain schema paths, not business values or signed URLs.
    throw new Error(`OpenAPI schema mismatch: ${ajv.errorsText(validate.errors)}`)
  }
}
export function assertResponse(path: string, method: string, status: number, headers: Record<string, string>, body: unknown): void {
  const op = operation(path, method)
  let response = op.responses[String(status)]
  // A default/framework response is not evidence of a validated business body.
  if (!response) throw new Error(`Undocumented response status: ${method} ${path}: ${status}`)
  if (response.$ref) {
    const name = response.$ref.replace('#/components/responses/', '')
    response = contract.components.responses[name]
    if (!response) throw new Error('Unresolved response reference')
  }
  const media = headers['content-type']?.split(';')[0].trim().toLowerCase()
  const content = media && response.content?.[media]
  if (!content) throw new Error('Undocumented response media type or body')
  assertSchema(content.schema, body)
  for (const [name, header] of Object.entries(response.headers ?? {})) {
    const value = headers[name.toLowerCase()]
    if (value === undefined && header.required) throw new Error(`Missing response header: ${name}`)
    if (value !== undefined) assertSchema(header.schema, value)
  }
  if (media === 'application/problem+json') {
    const problem = body as Record<string, unknown>
    if (problem.status !== status || problem.error !== problem.detail || problem.requestId !== headers['x-request-id']) {
      throw new Error('Inconsistent problem status, compatibility detail or request ID')
    }
  }
}
