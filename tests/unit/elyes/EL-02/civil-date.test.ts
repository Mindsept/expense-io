import { describe, expect, it } from 'vitest'
import { formatCivilDate } from '@/utils/civil-date'

describe('formatCivilDate', () => {
  it('keeps a civil day independent from the local timezone', () => {
    expect(formatCivilDate('2026-10-16')).toBe('16 oct. 2026')
  })

  it('supports leap days and rejects invalid dates or timestamps', () => {
    expect(formatCivilDate('2024-02-29')).toBe('29 févr. 2024')
    for (const value of ['2025-02-29', '2026-02-31', '2026-13-01', '', '2026-10-16T00:00:00Z', null]) {
      expect(formatCivilDate(value)).toBe('Date indisponible')
    }
  })
})
