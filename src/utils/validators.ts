const EMAIL_PATTERN = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value)
}

export function isPositiveAmount(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function isCivilDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= days[month - 1]
}
