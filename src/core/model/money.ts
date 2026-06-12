/**
 * Money — exact integer arithmetic in paise.
 *
 * P5 (SPEC): never float arithmetic on money. Parse rupees → paise once at the
 * ingestion boundary, format paise → rupees only at render/export. JS `number`
 * is safe up to 9.0e15 paise (≈ ₹90 lakh crore) which no company ledger exceeds
 * (ADR-002), so we use a branded `number` rather than bigint.
 */

declare const PaiseBrand: unique symbol
/** A monetary amount stored as an integer number of paise. */
export type Paise = number & { readonly [PaiseBrand]: true }

export const ZERO = 0 as Paise

/** Construct paise from a known-integer paise value. */
export function paise(n: number): Paise {
  return Math.round(n) as Paise
}

/**
 * Parse a rupee value (as found in a Tally export cell) into paise.
 *
 * Accepts: numbers (SheetJS usually yields these), and strings possibly using
 * the Indian grouping format ("1,23,456.78"), a leading/trailing sign, a
 * trailing "Cr"/"Dr" marker, or surrounding whitespace. Returns null when the
 * input is empty/blank; throws `MoneyParseError` on a genuinely unparseable
 * non-empty value so ingestion can fail loud (P6).
 */
export class MoneyParseError extends Error {
  constructor(public readonly raw: unknown) {
    super(`Unparseable money value: ${JSON.stringify(raw)}`)
    this.name = 'MoneyParseError'
  }
}

export function rupeesToPaise(raw: unknown): Paise | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) throw new MoneyParseError(raw)
    return Math.round(raw * 100) as Paise
  }
  if (typeof raw !== 'string') throw new MoneyParseError(raw)

  let s = raw.trim()
  if (s === '') return null

  // Strip Dr/Cr markers (sign handled by exporter's numeric sign already).
  let drCrSign = 1
  const drCr = s.match(/\b(dr|cr)\b\.?$/i)
  if (drCr) {
    s = s.slice(0, drCr.index).trim()
  }

  // Parenthesised negatives: (1,234.00)
  let paren = 1
  if (/^\(.*\)$/.test(s)) {
    paren = -1
    s = s.slice(1, -1).trim()
  }

  // Remove grouping commas (Indian or international) and spaces.
  s = s.replace(/[, ]/g, '')

  if (!/^[+-]?\d*\.?\d+$/.test(s)) throw new MoneyParseError(raw)
  const val = Number(s)
  if (!Number.isFinite(val)) throw new MoneyParseError(raw)
  return Math.round(val * paren * drCrSign * 100) as Paise
}

export function add(a: Paise, b: Paise): Paise {
  return (a + b) as Paise
}

export function sub(a: Paise, b: Paise): Paise {
  return (a - b) as Paise
}

export function neg(a: Paise): Paise {
  return -a as Paise
}

export function sum(xs: readonly Paise[]): Paise {
  let acc = 0
  for (const x of xs) acc += x
  return acc as Paise
}

export function isZero(a: Paise): boolean {
  return a === 0
}

/** Format paise as Indian-grouped rupees, e.g. 12345678 → "1,23,456.78". */
export function formatINR(
  a: Paise,
  opts: { sign?: boolean; blankZero?: boolean } = {},
): string {
  if (opts.blankZero && a === 0) return ''
  const negative = a < 0
  const abs = Math.abs(a)
  const rupees = Math.floor(abs / 100)
  const p = (abs % 100).toString().padStart(2, '0')
  const grouped = groupIndian(rupees)
  const body = `${grouped}.${p}`
  if (negative) return `(${body})`
  if (opts.sign) return `+${body}`
  return body
}

/** Indian digit grouping: last 3 digits, then groups of 2. */
function groupIndian(n: number): string {
  const s = n.toString()
  if (s.length <= 3) return s
  const last3 = s.slice(-3)
  const rest = s.slice(0, -3)
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')
  return `${grouped},${last3}`
}
