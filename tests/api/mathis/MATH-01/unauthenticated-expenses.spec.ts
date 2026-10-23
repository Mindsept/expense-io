import { expect, test } from '@playwright/test'
import { readTestTarget } from '../../../support/test-target'

const baseURL = readTestTarget()
const requestId = '11111111-1111-4111-8111-111111111111'

test('anonymous HTTP GET /api/expense-notes returns 401 from the real application', async ({ request }) => {
  const response = await request.get(`${baseURL}/api/expense-notes`, {
    headers: { 'X-Request-Id': requestId }, maxRedirects: 0, timeout: 10_000,
  })
  expect(response.status()).toBe(401)
  expect(response.headers()['content-type']).toContain('application/problem+json')
  expect(response.headers()['x-request-id']).toBe(requestId)
  expect(await response.json()).toEqual({
    type: 'urn:expense-io:problem:unauthenticated', title: 'Authentication required',
    status: 401, detail: 'Sign in to continue.', error: 'Sign in to continue.', requestId,
  })
})
