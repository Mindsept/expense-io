const civilDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/

export function formatCivilDate(value: unknown): string {
  if (typeof value !== 'string') return 'Date indisponible'
  const match = civilDatePattern.exec(value)
  if (!match) return 'Date indisponible'

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return 'Date indisponible'
  }

  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(date)
}
