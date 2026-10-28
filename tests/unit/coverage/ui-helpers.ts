import { vi } from 'vitest'

export const note = { id: 'note-1', userId: 'employee-1', author: { id: 'employee-1', displayName: 'Alice' }, amount: 18.75, expenseDate: '2026-10-20', description: 'Taxi client', status: 'pending', createdAt: '2026-10-20T12:00:00Z' }
export function page(items: unknown[] = [note], current = 1, total = items.length, withAmount = true) {
  return { items, pagination: { page: current, pageSize: 20, totalItems: total }, totals: { count: total, scope: 'filtered', ...(withAmount ? { amount: 375 } : {}) } }
}
export function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }) }
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
export function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => handler(String(input), init))
  vi.stubGlobal('fetch', fetch)
  return fetch
}
