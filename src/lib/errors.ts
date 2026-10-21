const problems = {
  validation: { status: 400, title: 'Invalid request', detail: 'Check the required fields and their format.' },
  invalid_json: { status: 400, title: 'Invalid JSON', detail: 'The request body must be a valid JSON object.' },
  invalid_manager_assignment: { status: 400, title: 'Invalid manager assignment', detail: 'Provide managerId as a UUID or explicit null.' },
  unauthenticated: { status: 401, title: 'Authentication required', detail: 'Sign in to continue.' },
  forbidden: { status: 403, title: 'Forbidden', detail: 'Your role does not allow this operation.' },
  not_found: { status: 404, title: 'Not found', detail: 'The requested resource was not found.' },
  conflict: { status: 409, title: 'Conflict', detail: 'This expense has already been decided.' },
  invalid_manager: { status: 409, title: 'Invalid manager', detail: 'The selected manager cannot be assigned.' },
  technical_failure: { status: 500, title: 'Internal server error', detail: 'The operation could not be completed. Try again later.' },
} as const

export type ProblemCode = keyof typeof problems

/** Only reviewed, static messages may cross the HTTP boundary. Never pass a raw cause as detail. */
export class ApiError extends Error {
  constructor(readonly code: ProblemCode) {
    super(problems[code].detail)
    this.name = 'ApiError'
  }
}

export type HttpDiagnostic = Readonly<{
  level: 'info' | 'warn' | 'error'
  operation: string
  status: number
  requestId: string
  durationMs: number
  result: 'success' | 'client_error' | 'server_error'
}>

/** LE-08 may supply an adapter at the route boundary; it receives no request or exception. */
export type HttpObserver = (event: HttpDiagnostic) => void | Promise<void>

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const operationPattern = /^[a-z][a-z0-9._-]{0,79}$/

function requestIdFor(candidate?: string | null): string {
  return candidate && requestIdPattern.test(candidate) ? candidate.toLowerCase() : crypto.randomUUID()
}

function diagnose(event: HttpDiagnostic, observer?: HttpObserver): void {
  // Allowlisted fields only: no URLs, bodies, SQL, user/tenant IDs, cookies, tokens or causes.
  const frozenEvent = Object.freeze(event)
  try {
    console[event.level](JSON.stringify(frozenEvent))
  } catch {
    // A logging transport failure must not replace the application response.
  }
  try {
    // Async delivery is not awaited. Adapters must keep their synchronous work short.
    void Promise.resolve(observer?.(frozenEvent)).catch(() => {})
  } catch {
    // Synchronous observer failures are isolated too.
  }
}

function problemResponse(error: unknown, requestId: string): Response {
  const code = error instanceof ApiError && Object.hasOwn(problems, error.code)
    ? error.code
    : 'technical_failure'
  const problem = problems[code]
  return Response.json({
    type: `urn:expense-io:problem:${code}`,
    ...problem,
    error: problem.detail,
    requestId,
  }, {
    status: problem.status,
    headers: { 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store', 'X-Request-Id': requestId },
  })
}

/** Compatibility for routes not migrated yet. New HTTP handlers should use withApiHandler. */
export function respondError(error: unknown): Response {
  const requestId = requestIdFor()
  const response = problemResponse(error, requestId)
  diagnose({
    level: response.status >= 500 ? 'error' : 'warn',
    operation: 'legacy.api',
    status: response.status,
    requestId,
    durationMs: 0,
    result: response.status >= 500 ? 'server_error' : 'client_error',
  })
  return response
}

/** HTTP route handlers only. Do not wrap server actions (redirect/notFound are control flow). */
export async function withApiHandler(
  request: Request,
  operation: string,
  handler: () => Promise<Response>,
  observer?: HttpObserver,
): Promise<Response> {
  const requestId = requestIdFor(request.headers.get('x-request-id'))
  const startedAt = performance.now()
  let response: Response
  try {
    // Await the entire handler, including transactions and COMMIT, before returning success.
    response = await handler()
  } catch (error) {
    response = problemResponse(error, requestId)
  }
  // A fetched or redirect response can have immutable headers. Keep its body and DTO intact.
  const headers = new Headers(response.headers)
  headers.set('X-Request-Id', requestId)
  response = new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  diagnose({
    level: response.status >= 500 ? 'error' : response.status >= 400 ? 'warn' : 'info',
    operation: operationPattern.test(operation) ? operation : 'unknown.api',
    status: response.status,
    requestId,
    durationMs: Math.max(0, performance.now() - startedAt),
    result: response.status >= 500 ? 'server_error' : response.status >= 400 ? 'client_error' : 'success',
  }, observer)
  return response
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await request.json()
  } catch (error) {
    if (error instanceof SyntaxError) throw new ApiError('invalid_json')
    throw error
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError('invalid_json')
  }
  return body as Record<string, unknown>
}
