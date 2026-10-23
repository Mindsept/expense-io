import type { PoolClient } from 'pg'
import { ApiError } from '@/lib/errors'
import { expenseSort } from '@/lib/expense-input'

export type PageRequest = Readonly<{ page: number; pageSize: number; offset: number }>
export type ListOrder = Readonly<{ column: 'created_at' | 'amount' | 'expense_date' | 'name'; direction: 'ASC' | 'DESC' }>

export function singleParameter(parameters: URLSearchParams, name: string): string | null {
  if (parameters.getAll(name).length > 1) throw new ApiError('validation')
  return parameters.get(name)
}
function positiveInteger(value: string | null, fallback: number): number {
  if (value === null) return fallback
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new ApiError('validation')
  return Number(value)
}
/** Explicit opt-in only; unpaginated legacy calls must never be silently truncated. */
export function readPagination(parameters: URLSearchParams): PageRequest | undefined {
  const rawPage = singleParameter(parameters, 'page'), rawSize = singleParameter(parameters, 'pageSize')
  if (rawPage === null && rawSize === null) return undefined
  const page = positiveInteger(rawPage, 1), pageSize = positiveInteger(rawSize, 20)
  const offset = (page - 1) * pageSize
  if (pageSize > 100 || !Number.isSafeInteger(offset)) throw new ApiError('validation')
  return Object.freeze({ page, pageSize, offset })
}
export function readExpenseOrder(parameters: URLSearchParams, fallback: 'created_at ASC' | 'created_at DESC'): ListOrder {
  const validated = expenseSort(parameters)
  const [column, direction] = (parameters.get('sort') ? validated : fallback).split(' ')
  return { column: column as ListOrder['column'], direction: direction as ListOrder['direction'] }
}
export function readDirectoryOrder(parameters: URLSearchParams): ListOrder {
  const value = singleParameter(parameters, 'sort') || 'name ASC'
  if (value !== 'name ASC' && value !== 'name DESC') throw new ApiError('validation')
  return { column: 'name', direction: value.endsWith('DESC') ? 'DESC' : 'ASC' }
}
/** All fields are internal allowlisted identifiers; no request string is interpolated. */
export function orderBy(order: ListOrder, alias = ''): string {
  const prefix = alias ? `${alias}.` : ''
  return `${prefix}${order.column} ${order.direction}, ${prefix}id ${order.direction}`
}

export function directoryFilters(parameters: URLSearchParams) {
  const q = (singleParameter(parameters, 'q') ?? '').trim()
  const role = singleParameter(parameters, 'role')
  const selectedManagerId = singleParameter(parameters, 'selectedManagerId')
  if (q.length > 120 || /[\u0000-\u001f\u007f]/.test(q) || (role !== null && role !== 'manager') ||
      (selectedManagerId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(selectedManagerId))) throw new ApiError('validation')
  return { q, role, selectedManagerId, search: `%${q.replace(/[\\%_]/g, '\\$&')}%` }
}

interface PageRow {
  items: Record<string, unknown>[]
  total_count: string
  total_cents?: string
  selected_manager?: Record<string, unknown> | null
}
/**
 * One SQL statement, one snapshot and one shared authorization/filter set for
 * rows and aggregates, including empty/out-of-range pages. No DB helper changes.
 */
export async function queryPage(client: Pick<PoolClient, 'query'>, input: {
  sourceSql: string; values: unknown[]; order: ListOrder; page: PageRequest; monetary?: boolean; selectionSql?: string
}) {
  const { sourceSql, values, order, page, monetary = false, selectionSql } = input
  const result = await client.query<PageRow>(
    `WITH filtered AS (${sourceSql}),
     summary AS (SELECT count(*)::text AS total_count${monetary ? ', COALESCE(sum(amount) * 100, 0)::numeric(100,0)::text AS total_cents' : ''} FROM filtered)
     SELECT summary.*, COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY ${orderBy(order, 'p')})
       FROM (SELECT * FROM filtered ORDER BY ${orderBy(order)} LIMIT $${values.length + 1} OFFSET $${values.length + 2}) p), '[]'::jsonb) AS items
       ${selectionSql ? `, (${selectionSql}) AS selected_manager` : ''}
     FROM summary`, [...values, page.pageSize, page.offset],
  )
  const row = result.rows[0]
  if (!row || !Array.isArray(row.items) || !/^\d+$/.test(row.total_count)) throw new Error('Invalid page aggregate')
  const count = Number(row.total_count)
  if (!Number.isSafeInteger(count)) throw new Error('Page count exceeds numeric response range')
  let amount: number | undefined
  if (monetary) {
    if (typeof row.total_cents !== 'string' || !/^\d+$/.test(row.total_cents)) throw new Error('Invalid monetary aggregate')
    const cents = BigInt(row.total_cents)
    if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Page amount exceeds numeric response range')
    amount = Number(cents) / 100
  }
  return {
    rows: row.items,
    pagination: { page: page.page, pageSize: page.pageSize, totalItems: count },
    totals: { ...(amount === undefined ? {} : { amount }), count, scope: 'filtered' as const },
    selectedManager: row.selected_manager ?? null,
  }
}

export function listResponse(body: unknown, paged: boolean): Response {
  return Response.json(body, { headers: { 'Cache-Control': 'no-store', 'X-Pagination-Mode': paged ? 'paged' : 'legacy' } })
}
