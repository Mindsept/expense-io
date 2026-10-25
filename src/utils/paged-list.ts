export interface PageInfo {
  page: number
  pageSize: number
  totalItems: number
}

export interface PageTotals {
  count: number
  amount?: number
  scope: 'filtered'
}

export interface PagedList<T> {
  items: T[]
  pagination: PageInfo
  totals: PageTotals
}

export function parsePagedList<T>(value: unknown, hasAmount: boolean): PagedList<T> {
  if (!value || typeof value !== 'object') throw new Error('Invalid paginated list')
  const record = value as Record<string, unknown>
  const pagination = record.pagination as Record<string, unknown> | undefined
  const totals = record.totals as Record<string, unknown> | undefined
  if (!Array.isArray(record.items) || !pagination || !totals ||
      !Number.isSafeInteger(pagination.page) || (pagination.page as number) < 1 ||
      !Number.isSafeInteger(pagination.pageSize) || (pagination.pageSize as number) < 1 ||
      !Number.isSafeInteger(pagination.totalItems) || (pagination.totalItems as number) < 0 ||
      !Number.isSafeInteger(totals.count) || (totals.count as number) < 0 ||
      totals.count !== pagination.totalItems ||
      totals.scope !== 'filtered' ||
      (hasAmount && (typeof totals.amount !== 'number' || !Number.isFinite(totals.amount))) ||
      (!hasAmount && 'amount' in totals)) {
    throw new Error('Invalid paginated list')
  }

  return {
    items: record.items as T[],
    pagination: {
      page: pagination.page as number,
      pageSize: pagination.pageSize as number,
      totalItems: pagination.totalItems as number,
    },
    totals: {
      count: totals.count as number,
      ...(hasAmount ? { amount: totals.amount as number } : {}),
      scope: 'filtered',
    },
  }
}

export function pageCount(totalItems: number, pageSize: number) {
  return Math.max(1, Math.ceil(totalItems / pageSize))
}

export function pageRange(page: number, pageSize: number, totalItems: number) {
  return totalItems === 0
    ? { start: 0, end: 0 }
    : { start: (page - 1) * pageSize + 1, end: Math.min(page * pageSize, totalItems) }
}
