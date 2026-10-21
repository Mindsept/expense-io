import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, respondError, withApiHandler, type HttpDiagnostic, type ProblemCode } from '../../../../src/lib/errors'

const requestId = '11111111-1111-4111-8111-111111111111'
const secret = 'private-sentinel-password-SQL-token'
const request = () => new Request('http://localhost/api/example?token=never-log-this', {
  headers: { 'X-Request-Id': requestId, Authorization: `Bearer ${secret}` },
})
let logs: string[]

beforeEach(() => {
  logs = []
  for (const level of ['info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((value: string) => { logs.push(value) })
  }
})
afterEach(() => vi.restoreAllMocks())

describe('HTTP problem contract', () => {
  it.each<[ProblemCode, number]>([
    ['validation', 400], ['invalid_json', 400], ['invalid_manager_assignment', 400],
    ['unauthenticated', 401], ['forbidden', 403], ['not_found', 404],
    ['conflict', 409], ['invalid_manager', 409], ['last_active_hr', 409], ['manager_cycle', 409], ['manager_assignment_busy', 409], ['technical_failure', 500],
  ])('maps %s to %i with compatible details', async (code, status) => {
    const response = await withApiHandler(request(), 'expense.test', async () => { throw new ApiError(code) })
    const body = await response.json()
    expect(response.status).toBe(status)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body).toEqual({
      type: `urn:expense-io:problem:${code}`, title: expect.any(String), status,
      detail: expect.any(String), error: body.detail, requestId,
    })
    expect(response.headers.get('x-request-id')).toBe(requestId)
    expect(JSON.parse(logs[0])).toMatchObject({ status, requestId, operation: 'expense.test' })
  })

  it.each([new Error(secret), secret, { message: secret, status: 400, detail: secret }])('does not serialize untrusted exceptions', async (error) => {
    const response = await withApiHandler(request(), 'expense.test', async () => { throw error })
    expect(response.status).toBe(500)
    const body = await response.text()
    expect(body + logs.join()).not.toContain(secret)
    expect(body + logs.join()).not.toContain('never-log-this')
    expect(body).not.toContain('stack')
    expect(JSON.parse(logs[0])).toEqual({
      level: 'error', operation: 'expense.test', requestId, status: 500,
      durationMs: expect.any(Number), result: 'server_error',
    })
  })

  it.each(['', 'Bearer-secret', 'x'.repeat(200), '11111111-1111-1111-1111-111111111111'])('replaces an invalid correlation id', async (candidate) => {
    const response = await withApiHandler(new Request('http://localhost', { headers: { 'x-request-id': candidate } }), 'expense.test', async () => { throw new ApiError('validation') })
    const body = await response.json()
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.requestId).not.toBe(candidate)
    expect(response.headers.get('x-request-id')).toBe(body.requestId)
    expect(JSON.parse(logs[0]).requestId).toBe(body.requestId)
  })

  it('preserves the success DTO and records successful requests too', async () => {
    const dto = { id: 'expense', amount: 12.5, status: 'pending' }
    const response = await withApiHandler(request(), 'expense.submit', async () => Response.json(dto, { status: 201 }))
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(dto)
    expect(JSON.parse(logs[0])).toMatchObject({ level: 'info', status: 201, result: 'success', requestId })
  })

  it('adds correlation to responses with immutable headers', async () => {
    const response = await withApiHandler(request(), 'expense.test', async () => Response.redirect('http://localhost/login'))
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('http://localhost/login')
    expect(response.headers.get('x-request-id')).toBe(requestId)
  })

  it('keeps the legacy helper safe while consumers migrate', async () => {
    const response = respondError(new Error(secret))
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain(secret)
    expect(logs.join()).not.toContain(secret)
    expect(JSON.parse(logs[0]).operation).toBe('legacy.api')
  })
})

describe('LE-08 observer boundary', () => {
  it.each([true, false])('isolates throwing collectors on success and failure (%s)', async (succeed) => {
    for (const observer of [() => { throw new Error(secret) }, () => Promise.reject(new Error(secret))]) {
      const response = await withApiHandler(request(), 'expense.test', async () => {
        if (!succeed) throw new ApiError('conflict')
        return Response.json({ ok: true })
      }, observer)
      expect(response.status).toBe(succeed ? 200 : 409)
      await Promise.resolve()
    }
    expect(logs.join()).not.toContain(secret)
  })

  it('does not wait for a collector and gives it only immutable diagnostics', async () => {
    const events: HttpDiagnostic[] = []
    const response = await withApiHandler(request(), 'expense.test', async () => Response.json({ ok: true }), (event) => {
      events.push(event)
      return new Promise(() => {})
    })
    expect(response.status).toBe(200)
    expect(Object.isFrozen(events[0])).toBe(true)
    expect(Object.keys(events[0]).sort()).toEqual(['durationMs', 'level', 'operation', 'requestId', 'result', 'status'])
    expect(events[0].durationMs).toBeGreaterThanOrEqual(0)
  })

  it('isolates logging transport failures', async () => {
    vi.mocked(console.error).mockImplementation(() => { throw new Error(secret) })
    const response = await withApiHandler(request(), 'expense.test', async () => { throw new Error(secret) })
    expect(response.status).toBe(500)
  })

  it('replaces invalid operation labels without logging them', async () => {
    await withApiHandler(request(), `query\n${secret}`, async () => Response.json({ ok: true }))
    expect(JSON.parse(logs[0]).operation).toBe('unknown.api')
    expect(logs.join()).not.toContain(secret)
  })
})
