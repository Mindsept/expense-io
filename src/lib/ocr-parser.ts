import { isCivilDate } from '@/utils/validators'

export interface ExpenseNoteSuggestion {
  amount?: number
  expenseDate?: string
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u00a0\u202f]/g, ' ').toLowerCase()
}

// Longer labels first, so sous-total and total HT cannot be mistaken for total.
// The trailing letter guard allows compact labels such as HT100 / TTC120.
const labels = /\b(?:sous[ -]*total|subtotal|total\s+(?:hors\s+taxes|ht)|hors\s+taxes|ht|tva|remise|rendu|monnaie|total\s+(?:ttc|final|a\s+payer)|montant\s+(?:total|a\s+payer)|net\s+a\s+payer|a\s+payer|ttc|total|montant)(?![a-z])/g

function priority(label: string): number {
  if (/^(sous[ -]*total|subtotal|total\s+(?:ht|hors)|hors|ht|tva|remise|rendu|monnaie)/.test(label)) return -1
  if (/ttc|final|a\s+payer/.test(label)) return 3
  return label.includes('total') ? 2 : 1
}

function decimalAmount(text: string): number | undefined {
  const value = text.trim().replace(/^[:=]\s*/, '').replace(/^(?:eur\b|€)\s*/, '').replace(/\s*(?:eur\b|€)$/, '').trim()
  // French grouping (space or dot), comma/dot decimals, or an integer.
  // Match the complete token: no exponent, suffix, negative, rounded or partial value.
  if (!/^(?:\d+|\d{1,3}(?:[ .]\d{3})+)(?:[,.]\d{2})?$/.test(value)) return undefined
  const separator = /[,.]\d{2}$/.test(value) ? Math.max(value.lastIndexOf(','), value.lastIndexOf('.')) : -1
  const integer = (separator < 0 ? value : value.slice(0, separator)).replace(/[ .]/g, '')
  const cents = separator < 0 ? '00' : value.slice(separator + 1)
  const amount = Number(`${integer}.${cents}`)
  return Number.isFinite(amount) && amount > 0 && amount <= 99_999_999.99 ? amount : undefined
}

function parseAmount(text: string): number | undefined {
  const candidates: { priority: number; amount: number | undefined }[] = []
  for (const line of text.split(/\r?\n/)) {
    const matches = [...line.matchAll(labels)]
    if (matches.length === 0) {
      if (/\beur\b|€/.test(line)) {
        const amount = decimalAmount(line)
        if (amount !== undefined) candidates.push({ priority: 0, amount })
      }
      continue
    }
    for (let i = 0; i < matches.length; i++) {
      const label = matches[i]
      const rank = priority(label[0])
      if (rank < 0) continue
      const value = line.slice(label.index! + label[0].length, matches[i + 1]?.index)
      candidates.push({ priority: rank, amount: decimalAmount(value) })
    }
  }
  const highest = candidates.reduce((highest, candidate) => Math.max(highest, candidate.priority), -1)
  const finalists = candidates.filter(candidate => candidate.priority === highest)
  if (finalists.length === 0 || finalists.some(candidate => candidate.amount === undefined)) return undefined
  const values = new Set(finalists.map(candidate => candidate.amount))
  return values.size === 1 ? finalists[0].amount : undefined
}

const frenchMonths: Record<string, number> = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
}

function parseDate(text: string): string | undefined {
  const dates = new Set<string>()
  const add = (year: number, month: number, day: number) => {
    const date = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (isCivilDate(date)) dates.add(date)
  }
  for (const match of text.matchAll(/(?<![\d/.-])(\d{4})-(\d{1,2})-(\d{1,2})(?![\d/.-])/g)) {
    add(Number(match[1]), Number(match[2]), Number(match[3]))
  }
  for (const match of text.matchAll(/(?<![\d/.-])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?![\d/.-])/g)) {
    add(Number(match[3]) + (match[3].length === 2 ? 2000 : 0), Number(match[2]), Number(match[1]))
  }
  const textual = new RegExp(`\\b(\\d{1,2})\\s+(${Object.keys(frenchMonths).join('|')})\\s+(\\d{4})\\b`, 'g')
  for (const match of text.matchAll(textual)) add(Number(match[3]), frenchMonths[match[2]], Number(match[1]))
  // An expense date cannot be selected reliably between two different printed dates.
  return dates.size === 1 ? [...dates][0] : undefined
}

/** Pure parsing: successful recognition may legitimately yield no suggestion. */
export function parseReceiptText(text: string): ExpenseNoteSuggestion {
  const normalized = normalize(text)
  const amount = parseAmount(normalized)
  const expenseDate = parseDate(normalized)
  return {
    ...(amount === undefined ? {} : { amount }),
    ...(expenseDate === undefined ? {} : { expenseDate }),
  }
}
