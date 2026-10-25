'use client'

import { pageCount, pageRange } from '@/utils/paged-list'

interface PaginationControlsProps {
  page: number
  pageSize: number
  totalItems: number
  disabled?: boolean
  onPageChange: (page: number) => void
  label: string
}

export function PaginationControls({
  page, pageSize, totalItems, disabled = false, onPageChange, label,
}: PaginationControlsProps) {
  const pages = pageCount(totalItems, pageSize)
  const range = pageRange(page, pageSize, totalItems)

  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-6 py-3 text-sm dark:border-gray-800">
      <p aria-live="polite" className="text-gray-600 dark:text-gray-300">
        {range.start}–{range.end} sur {totalItems}
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={() => onPageChange(page - 1)} disabled={disabled || page <= 1}
          className="rounded border border-gray-300 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700">
          Précédent
        </button>
        <span className="self-center whitespace-nowrap" aria-label={`Page ${page} sur ${pages}`}>{page} / {pages}</span>
        <button type="button" onClick={() => onPageChange(page + 1)} disabled={disabled || page >= pages}
          className="rounded border border-gray-300 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700">
          Suivant
        </button>
      </div>
    </nav>
  )
}
