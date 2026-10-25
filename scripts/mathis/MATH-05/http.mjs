/**
 * Measure one complete response, then release Playwright's retained body.
 * Cleanup is excluded from the latency; a cleanup failure still fails the attempt.
 * @param {{get(route: string, options: {timeout: number}): Promise<{status(): number, body(): Promise<Buffer>, dispose(): Promise<void>}>}} client
 * @param {{route: string, expected: number, pageSize?: number}} scenario
 */
export async function measureListRequest(client, scenario) {
  const started = performance.now()
  let response, status = null, bytes = 0, ok = false, error = null
  try {
    response = await client.get(scenario.route, { timeout: 10000 })
    status = response.status()
    const body = await response.body()
    bytes = body.length
    if (status === 200) {
      const rows = JSON.parse(body.toString())
      if (scenario.pageSize === undefined) {
        ok = Array.isArray(rows) && rows.length === scenario.expected
        if (!ok) error = 'unexpected-row-count'
      } else {
        ok = !Array.isArray(rows) && Array.isArray(rows?.items) && rows.items.length === Math.min(scenario.pageSize, scenario.expected) &&
          rows.pagination?.page === 1 && rows.pagination?.pageSize === scenario.pageSize && rows.pagination?.totalItems === scenario.expected &&
          rows.totals?.count === scenario.expected && rows.totals?.scope === 'filtered' && Number.isFinite(rows.totals?.amount)
        if (!ok) error = 'unexpected-pagination'
      }
    } else error = 'http-error'
  } catch (failure) {
    error = failure?.name === 'TimeoutError' ? 'timeout' : 'request-error'
  }
  const ms = Number((performance.now() - started).toFixed(3))
  try {
    await response?.dispose()
  } catch {
    ok = false
    error = error ?? 'response-cleanup-error'
  }
  return { status, bytes, ms, ok, error }
}

/**
 * Keep a request context only for its scenario, including authentication.
 * @template {{dispose(): Promise<void>}} Client
 * @template Result
 * @param {() => Promise<Client>} create
 * @param {(client: Client) => Promise<Result>} action
 */
export async function withRequestContext(create, action) {
  const client = await create()
  try {
    return await action(client)
  } finally {
    await client.dispose()
  }
}
