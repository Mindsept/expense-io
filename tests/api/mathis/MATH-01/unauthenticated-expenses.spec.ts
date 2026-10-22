import { expect, test } from '@playwright/test'
import { readTestTarget } from '../../../support/test-target'

const baseURL = readTestTarget()

test('anonymous HTTP GET /api/expense-notes returns 401 from the real application', async ({ request }) => {
  const response = await request.get(`${baseURL}/api/expense-notes`, { maxRedirects: 0, timeout: 10_000 })
  expect(response.status()).toBe(401)
  expect(response.headers()['content-type']).toContain('application/json')
  expect(await response.json()).toEqual({ error: 'Unauthorized' })
})
